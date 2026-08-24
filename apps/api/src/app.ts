import {
  HealthResponseSchema,
  EngagementMutationErrorSchema,
  SYSTEM_STATUS_VERSION,
  SystemStatusResponseSchema,
  type Readiness,
} from "@blackglass/contracts";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import type {
  EngagementRepository,
  EvidenceGrantRepository,
  OperatorCommandRepository,
  RunRepository,
  RunnerRepository,
} from "@blackglass/db";

import { registerActionMutationRoutes } from "./action-mutation-routes.js";
import { registerActionRoutes } from "./action-routes.js";
import { registerEngagementMutationRoutes } from "./engagement-mutation-routes.js";
import { registerEngagementRoutes } from "./engagement-routes.js";
import { registerRunnerAuthHook, stripAuthorizationHeader } from "./runner-http.js";
import { registerRunnerEnrollmentRoutes } from "./runner-enrollment-routes.js";
import { registerRunnerControlRoutes } from "./runner-routes.js";
import { registerRunnerEvidenceGrantRoutes } from "./runner-evidence-grant-routes.js";

interface BuildAppOptions {
  getDevelopmentStorageReadiness: () => Readiness | Promise<Readiness>;
  engagementRepository: Pick<
    EngagementRepository,
    | "getEngagement"
    | "listEngagements"
    | "listScopeRevisions"
    | "getAction"
    | "retryActionContext"
  > &
    Partial<Pick<EngagementRepository, "withWriteTx">>;
  operatorCommandRepository?: Pick<
    OperatorCommandRepository,
    "executeOperatorCommand"
  >;
  runRepository?: Pick<
    RunRepository,
    "acquireLease" | "heartbeat" | "appendEvent" | "completeRun"
  >;
  runnerRepository?: Pick<
    RunnerRepository,
    | "authenticate"
    | "startEnrollmentChallenge"
    | "confirmEnrollment"
    | "revoke"
    | "acceptHandshake"
    | "requireAcceptedSession"
  >;
  evidenceGrantRepository?: Pick<EvidenceGrantRepository, "createGrant">;
  logger?: FastifyServerOptions["logger"];
  now?: () => Date;
}

export function buildApp({
  engagementRepository,
  getDevelopmentStorageReadiness,
  operatorCommandRepository,
  runRepository,
  runnerRepository,
  evidenceGrantRepository,
  logger = false,
  now,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger:
      logger === false || logger === undefined
        ? false
        : {
            ...(typeof logger === "object" ? logger : {}),
            serializers: {
              ...(typeof logger === "object" ? logger.serializers : undefined),
              req(request) {
                return {
                  method: request.method,
                  url: request.url,
                  headers: stripAuthorizationHeader(
                    (request.headers ?? {}) as Record<string, unknown>,
                  ),
                };
              },
            },
          },
  });

  app.setErrorHandler((error, _request, reply) => {
    const clientError =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500;
    return reply
      .code(clientError ? 400 : 500)
      .type("application/json")
      .send(
        EngagementMutationErrorSchema.parse({
          code: clientError ? "invalid_request" : "invalid_persisted_data",
        }),
      );
  });

  registerRunnerAuthHook(app, runnerRepository);
  registerEngagementRoutes(app, engagementRepository);
  registerActionRoutes(app, engagementRepository);
  if (operatorCommandRepository !== undefined) {
    registerEngagementMutationRoutes(app, operatorCommandRepository);
    registerActionMutationRoutes(app, operatorCommandRepository);
    if (runnerRepository !== undefined) {
      registerRunnerEnrollmentRoutes(
        app,
        operatorCommandRepository,
        runnerRepository,
      );
    }
  }
  const withWriteTx = engagementRepository.withWriteTx;
  if (
    operatorCommandRepository !== undefined &&
    runRepository !== undefined &&
    runnerRepository !== undefined &&
    withWriteTx !== undefined
  ) {
    registerRunnerControlRoutes(app, {
      commandRepository: operatorCommandRepository,
      engagementRepository: {
        withWriteTx: withWriteTx.bind(engagementRepository),
      },
      runRepository,
      runnerRepository,
      ...(now === undefined ? {} : { now }),
    });
    if (evidenceGrantRepository !== undefined) {
      registerRunnerEvidenceGrantRoutes(app, {
        commandRepository: operatorCommandRepository,
        evidenceGrantRepository,
      });
    }
  }

  app.get("/health", async (_request, reply) => {
    const health = HealthResponseSchema.parse({ status: "ok" });
    return reply.code(200).type("application/json").send(health);
  });

  app.get("/api/v1/system/status", async (_request, reply) => {
    let developmentStorage: Readiness;
    try {
      developmentStorage = await getDevelopmentStorageReadiness();
    } catch {
      developmentStorage = "not_ready";
    }
    const status = SystemStatusResponseSchema.parse({
      version: SYSTEM_STATUS_VERSION,
      overall: developmentStorage,
      developmentStorage,
    });
    return reply
      .code(status.overall === "ready" ? 200 : 503)
      .type("application/json")
      .send(status);
  });

  return app;
}
