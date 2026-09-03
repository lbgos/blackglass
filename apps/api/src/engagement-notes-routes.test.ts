import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EngagementRepository, openEngagementDatabase } from "@blackglass/db";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const temporaryDirectories: string[] = [];
const openApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRepositoryBackedApp() {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "blackglass-notes-route-test-"),
  );
  temporaryDirectories.push(dataDirectory);
  await chmod(dataDirectory, 0o700);
  const database = openEngagementDatabase({ dataDirectory });
  let nextId = 1;
  let minute = 0;
  const repository = new EngagementRepository(database.db, {
    createId: () =>
      `10000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 12, 12, minute++)),
  });
  const app = buildApp({
    engagementRepository: repository,
    getDevelopmentStorageReadiness: () => "ready",
  });
  app.addHook("onClose", async () => database.close());
  openApps.push(app);
  return { app, repository };
}

describe("engagement notes routes", () => {
  it("round-trips markdown with a byte-identical body", async () => {
    const { app, repository } = await createRepositoryBackedApp();
    const created = repository.createEngagement({
      name: "Notes lab",
      kind: "lab",
      autoContinueWarnings: false,
    });
    if (!created.ok) throw new Error(`Fixture failed: ${created.error.code}`);
    const markdown = "# creds\nadmin / s3cret\n\nflag{notes-round-trip}";

    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/engagements/${created.value.id}/notes`,
      payload: { markdown },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      engagementId: created.value.id,
      markdown,
    });

    const loaded = await app.inject({
      method: "GET",
      url: `/api/v1/engagements/${created.value.id}/notes`,
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toMatchObject({
      engagementId: created.value.id,
      markdown,
    });
    expect(loaded.json().markdown).toBe(markdown);
  });

  it("returns an empty document before the first save", async () => {
    const { app, repository } = await createRepositoryBackedApp();
    const created = repository.createEngagement({
      name: "Notes lab",
      kind: "lab",
      autoContinueWarnings: false,
    });
    if (!created.ok) throw new Error(`Fixture failed: ${created.error.code}`);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/engagements/${created.value.id}/notes`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      engagementId: created.value.id,
      markdown: "",
    });
  });

  it("rejects oversize bodies and unknown engagements", async () => {
    const { app, repository } = await createRepositoryBackedApp();
    const created = repository.createEngagement({
      name: "Notes lab",
      kind: "lab",
      autoContinueWarnings: false,
    });
    if (!created.ok) throw new Error(`Fixture failed: ${created.error.code}`);

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/engagements/${created.value.id}/notes`,
          payload: { markdown: "a".repeat(65_537) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/engagements/10000000-0000-4000-8000-000000000099/notes",
          payload: { markdown: "# notes" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/engagements/not-an-id/notes",
        })
      ).statusCode,
    ).toBe(400);
  });
});
