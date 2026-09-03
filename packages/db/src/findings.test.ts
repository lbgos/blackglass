import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openEngagementDatabase } from "./database.js";
import { EngagementRepository } from "./repository.js";

const UNKNOWN_ID = "10000000-0000-4000-8000-000000000099";

interface Fixture {
  directory: string;
  database: ReturnType<typeof openEngagementDatabase>;
  repository: EngagementRepository;
}

const fixtures: Fixture[] = [];

function createFixture(): Fixture {
  const directory = mkdtempSync(path.join(tmpdir(), "blackglass-findings-test-"));
  chmodSync(directory, 0o700);
  const database = openEngagementDatabase({ dataDirectory: directory });
  let next = 1;
  let minute = 0;
  const repository = new EngagementRepository(database.db, {
    createId: () => `10000000-0000-4000-8000-${String(next++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 12, 12, minute++)),
  });
  const fixture = { directory, database, repository };
  fixtures.push(fixture);
  return fixture;
}

function createEngagement(repository: EngagementRepository) {
  const result = repository.createEngagement({
    name: "Findings lab",
    kind: "lab",
    description: null,
    authorizationContext: null,
    autoContinueWarnings: false,
  });
  if (!result.ok) throw new Error(`Fixture create failed: ${result.error.code}`);
  return result.value;
}

afterEach(() => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture === undefined) continue;
    if (fixture.database.sqlite.open) fixture.database.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

describe("findings persistence", () => {
  it("creates and lists findings scoped to one engagement", () => {
    const { repository } = createFixture();
    const first = createEngagement(repository);
    const second = createEngagement(repository);

    expect(repository.listFindings(first.id)).toEqual({ ok: true, value: [] });

    const created = repository.createFinding(first.id, {
      title: "Default credentials",
      severity: "high",
      body: "# impact\nAdmin access.",
      evidenceArtifactIds: ["nmap-xml-1"],
    });
    if (!created.ok) throw new Error(`Create failed: ${created.error.code}`);
    expect(created.value).toMatchObject({
      engagementId: first.id,
      title: "Default credentials",
      severity: "high",
      status: "open",
      evidenceArtifactIds: ["nmap-xml-1"],
    });

    const listed = repository.listFindings(first.id);
    if (!listed.ok) throw new Error(`List failed: ${listed.error.code}`);
    expect(listed.value.map((finding) => finding.id)).toEqual([created.value.id]);
    expect(repository.listFindings(second.id)).toEqual({ ok: true, value: [] });
    expect(repository.listFindings(UNKNOWN_ID)).toEqual({
      ok: false,
      error: { code: "engagement_not_found" },
    });
  });

  it("resolves and reopens with transition validation", () => {
    const { repository } = createFixture();
    const engagement = createEngagement(repository);
    const created = repository.createFinding(engagement.id, {
      title: "Open banner",
      severity: "low",
      body: "banner",
    });
    if (!created.ok) throw new Error(`Create failed: ${created.error.code}`);

    const resolved = repository.resolveFinding(engagement.id, created.value.id);
    if (!resolved.ok) throw new Error(`Resolve failed: ${resolved.error.code}`);
    expect(resolved.value.status).toBe("resolved");

    expect(repository.resolveFinding(engagement.id, created.value.id)).toEqual({
      ok: false,
      error: { code: "invalid_finding_transition" },
    });

    const reopened = repository.reopenFinding(engagement.id, created.value.id);
    if (!reopened.ok) throw new Error(`Reopen failed: ${reopened.error.code}`);
    expect(reopened.value.status).toBe("open");

    expect(repository.reopenFinding(engagement.id, created.value.id)).toEqual({
      ok: false,
      error: { code: "invalid_finding_transition" },
    });
    expect(repository.resolveFinding(engagement.id, UNKNOWN_ID)).toEqual({
      ok: false,
      error: { code: "finding_not_found" },
    });
  });

  it("rejects invalid input and archived engagement writes", () => {
    const { repository } = createFixture();
    const engagement = createEngagement(repository);

    expect(
      repository.createFinding(engagement.id, {
        title: "  padded  ",
        severity: "low",
        body: "",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_repository_input" } });
    expect(
      repository.createFinding(engagement.id, {
        title: "Finding",
        severity: "unknown",
        body: "",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_repository_input" } });
    expect(
      repository.createFinding(UNKNOWN_ID, {
        title: "Finding",
        severity: "low",
        body: "",
      }),
    ).toEqual({ ok: false, error: { code: "engagement_not_found" } });

    const archived = repository.archive(engagement.id, engagement.revision);
    if (!archived.ok) throw new Error(`Archive failed: ${archived.error.code}`);

    expect(
      repository.createFinding(engagement.id, {
        title: "Late finding",
        severity: "low",
        body: "",
      }),
    ).toEqual({ ok: false, error: { code: "engagement_archived" } });

    const fresh = createFixture();
    const active = createEngagement(fresh.repository);
    const created = fresh.repository.createFinding(active.id, {
      title: "Active finding",
      severity: "medium",
      body: "",
    });
    if (!created.ok) throw new Error(`Create failed: ${created.error.code}`);
    const archivedActive = fresh.repository.archive(active.id, active.revision);
    if (!archivedActive.ok) throw new Error(`Archive failed: ${archivedActive.error.code}`);
    expect(
      fresh.repository.resolveFinding(active.id, created.value.id),
    ).toEqual({ ok: false, error: { code: "engagement_archived" } });
    expect(
      fresh.repository.reopenFinding(active.id, created.value.id),
    ).toEqual({ ok: false, error: { code: "engagement_archived" } });
  });
});
