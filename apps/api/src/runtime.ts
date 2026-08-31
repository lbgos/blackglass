import {
  EngagementRepository,
  EvidenceGrantRepository,
  NmapServiceRepository,
  OperatorCommandRepository,
  RunRepository,
  RunnerRepository,
  openEngagementDatabase,
  type EngagementDatabase,
} from "@blackglass/db";
import { loadEvidenceNative } from "@blackglass/evidence-native";
import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import {
  bootstrapDevelopmentStorage,
  checkDevelopmentStorage,
} from "./development-storage.js";
import { BackupLock } from "./evidence/backup-lock.js";
import { EvidencePublicationService } from "./evidence/evidence-publication.js";
import { EvidenceStore } from "./evidence/evidence-store.js";
import { NmapProjectionService } from "./evidence/nmap-projection.js";

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
    const nmapServiceRepository = new NmapServiceRepository(database.db);

    // Evidence publication is fail-closed: without a loadable native binding
    // or valid managed evidence roots, the upload routes are not registered.
    let evidencePublication: EvidencePublicationService | undefined;
    let evidenceStore: EvidenceStore | undefined;
    let backupLock: BackupLock | undefined;
    const native = loadEvidenceNative();
    if (native.ok) {
      const storeResult = EvidenceStore.open(dataDirectory, native.binding);
      if (storeResult.ok) {
        const lockResult = BackupLock.open(dataDirectory, native.binding);
        if (!lockResult.ok) {
          storeResult.store.close();
          throw new Error("backup lockfile could not be established");
        }
        backupLock = lockResult.lock;
        const projection = new NmapProjectionService(storeResult.store, nmapServiceRepository);
        evidencePublication = new EvidencePublicationService({
          repository: evidenceGrantRepository,
          store: storeResult.store,
          quiesceGate: backupLock,
          onPublicationCommitted: (artifactId) => projection.projectForArtifact(artifactId),
        });
        evidenceStore = storeResult.store;
      }
    }

    const app = createApp({
      engagementRepository,
      operatorCommandRepository: new OperatorCommandRepository(
        engagementRepository,
      ),
      runRepository,
      runnerRepository,
      evidenceGrantRepository,
      ...(evidencePublication === undefined ? {} : { evidencePublication }),
      ...(evidenceStore === undefined ? {} : { evidenceStore }),
      ...(backupLock === undefined ? {} : { storageGate: backupLock }),
      nmapServiceRepository,
      async getDevelopmentStorageReadiness() {
        await checkDevelopmentStorage(dataDirectory);
        return "ready" as const;
      },
    });
    if (evidenceStore !== undefined && backupLock !== undefined) {
      registerStoreClose(app, evidenceStore, backupLock);
    }
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

function registerStoreClose(
  app: FastifyInstance,
  store: EvidenceStore,
  backupLock: BackupLock,
): void {
  let closed = false;
  app.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    backupLock.close();
    store.close();
  });
}
