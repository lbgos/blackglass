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
    path.join(tmpdir(), "blackglass-findings-route-test-"),
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

describe("findings routes", () => {
  it("creates, lists, resolves, and reopens a finding", async () => {
    const { app, repository } = await createRepositoryBackedApp();
    const createdEngagement = repository.createEngagement({
      name: "Findings lab",
      kind: "lab",
      autoContinueWarnings: false,
    });
    if (!createdEngagement.ok) throw new Error(`Fixture failed: ${createdEngagement.error.code}`);
    const engagementId = createdEngagement.value.id;

    const empty = await app.inject({
      method: "GET",
      url: `/api/v1/engagements/${engagementId}/findings`,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/engagements/${engagementId}/findings`,
      payload: {
        title: "Default credentials",
        severity: "high",
        body: "# impact\nAdmin access.",
        evidenceArtifactIds: ["nmap-xml-1"],
      },
    });
    expect(created.statusCode).toBe(201);
    const finding = created.json() as { id: string; status: string };
    expect(finding.status).toBe("open");

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/engagements/${engagementId}/findings`,
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as unknown[])).toHaveLength(1);

    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/engagements/${engagementId}/findings/${finding.id}/resolve`,
    });
    expect(resolved.statusCode).toBe(200);
    expect((resolved.json() as { status: string }).status).toBe("resolved");

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/engagements/${engagementId}/findings/${finding.id}/resolve`,
        })
      ).statusCode,
    ).toBe(409);

    const reopened = await app.inject({
      method: "POST",
      url: `/api/v1/engagements/${engagementId}/findings/${finding.id}/reopen`,
    });
    expect(reopened.statusCode).toBe(200);
    expect((reopened.json() as { status: string }).status).toBe("open");
  });

  it("rejects invalid input, unknown ids, and archived writes", async () => {
    const { app, repository } = await createRepositoryBackedApp();
    const createdEngagement = repository.createEngagement({
      name: "Findings lab",
      kind: "lab",
      autoContinueWarnings: false,
    });
    if (!createdEngagement.ok) throw new Error(`Fixture failed: ${createdEngagement.error.code}`);
    const engagementId = createdEngagement.value.id;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/engagements/${engagementId}/findings`,
          payload: { title: "", severity: "low", body: "" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/engagements/not-an-id/findings",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/engagements/10000000-0000-4000-8000-000000000099/findings",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/engagements/${engagementId}/findings/10000000-0000-4000-8000-000000000099/resolve`,
        })
      ).statusCode,
    ).toBe(404);

    const archived = repository.archive(engagementId, createdEngagement.value.revision);
    if (!archived.ok) throw new Error(`Fixture failed: ${archived.error.code}`);

    const write = await app.inject({
      method: "POST",
      url: `/api/v1/engagements/${engagementId}/findings`,
      payload: { title: "Late finding", severity: "low", body: "" },
    });
    expect(write.statusCode).toBe(409);
    expect(write.json()).toEqual({ code: "engagement_archived" });
  });
});
