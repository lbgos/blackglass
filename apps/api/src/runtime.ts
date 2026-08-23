import {
  EngagementRepository,
  EvidenceGrantRepository,
  OperatorCommandRepository,
  RunRepository,
  RunnerRepository,
  openEngagementDatabase,
  type EngagementDatabase,
} from "@blackglass/db";
import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import {
  bootstrapDevelopmentStorage,
  checkDevelopmentStorage,
} from "./development-storage.js";

interface RuntimeDependencies {
  bootstrapStorage?: typeof bootstrapDevelopmentStorage;
  createApp?: typeof buildApp;
  openDatabase?: typeof openEngagementDatabase;
}

export async function buildStorageBackedApp(
  dataDirectory: string,
  dependencies: RuntimeDependencies = {},
): Promise<FastifyInstance> {
  const bootstrapStorage =
    dependencies.bootstrapStorage ?? bootstrapDevelopmentStorage;
  const createApp = dependencies.createApp ?? buildApp;
  const openDatabase = dependencies.openDatabase ?? openEngagementDatabase;

  await bootstrapStorage(dataDirectory);
  const database = openDatabase({ dataDirectory });
  try {
    const engagementRepository = new EngagementRepository(database.db);
    const runRepository = new RunRepository(database.db);
    const runnerRepository = new RunnerRepository(database.db);
    const evidenceGrantRepository = new EvidenceGrantRepository(database.db);
    const app = createApp({
      engagementRepository,
      operatorCommandRepository: new OperatorCommandRepository(
        engagementRepository,
      ),
      runRepository,
      runnerRepository,
      evidenceGrantRepository,
      async getDevelopmentStorageReadiness() {
        await checkDevelopmentStorage(dataDirectory);
        return "ready" as const;
      },
    });
    registerDatabaseClose(app, database);
    return app;
  } catch (error) {
    database.close();
    throw error;
  }
}

function registerDatabaseClose(
  app: FastifyInstance,
  database: EngagementDatabase,
): void {
  let closed = false;
  app.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    database.close();
  });
}
