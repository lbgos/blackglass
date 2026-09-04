import {
  GetSettingsResponseSchema,
  UpdateSettingsRequestSchema,
} from "@blackglass/contracts";
import type { SettingsRepository } from "@blackglass/db";
import type { FastifyInstance, FastifyReply } from "fastify";

type SettingsStore = Pick<
  SettingsRepository,
  "getRunnerSettings" | "updateRunnerSettings"
>;

function sendError(reply: FastifyReply, status: number, code: string) {
  return reply.code(status).type("application/json").send({ code });
}

export function registerSettingsRoutes(app: FastifyInstance, deps: { repository: SettingsStore }) {
  app.get("/api/v1/settings/runner", async (_request, reply) => {
    let result: ReturnType<SettingsRepository["getRunnerSettings"]>;
    try {
      result = deps.repository.getRunnerSettings();
    } catch {
      return sendError(reply, 500, "invalid_persisted_data");
    }
    if (!result.ok) {
      if (result.error.code === "storage_busy") return sendError(reply, 503, "storage_busy");
      return sendError(reply, 500, "invalid_persisted_data");
    }
    const validated = GetSettingsResponseSchema.safeParse(result.value);
    if (!validated.success) return sendError(reply, 500, "invalid_persisted_data");
    return reply.code(200).type("application/json").send(validated.data);
  });

  app.put("/api/v1/settings/runner", async (request, reply) => {
    const body = UpdateSettingsRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 400, "invalid_request");
    let result: ReturnType<SettingsRepository["updateRunnerSettings"]>;
    try {
      result = deps.repository.updateRunnerSettings(body.data);
    } catch {
      return sendError(reply, 500, "invalid_persisted_data");
    }
    if (!result.ok) {
      if (result.error.code === "storage_busy") return sendError(reply, 503, "storage_busy");
      if (result.error.code === "invalid_persisted_data") {
        return sendError(reply, 500, "invalid_persisted_data");
      }
      return sendError(reply, 400, "invalid_request");
    }
    const validated = GetSettingsResponseSchema.safeParse(result.value);
    if (!validated.success) return sendError(reply, 500, "invalid_persisted_data");
    return reply.code(200).type("application/json").send(validated.data);
  });
}
