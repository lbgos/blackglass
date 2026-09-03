import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openEngagementDatabase } from "./database.js";
import { EngagementRepository } from "./repository.js";

const NOTES_ID = "10000000-0000-4000-8000-000000000001";
const UNKNOWN_ID = "10000000-0000-4000-8000-000000000099";

interface Fixture {
  directory: string;
  database: ReturnType<typeof openEngagementDatabase>;
  repository: EngagementRepository;
}

const fixtures: Fixture[] = [];

function createFixture(): Fixture {
  const directory = mkdtempSync(path.join(tmpdir(), "blackglass-notes-test-"));
  chmodSync(directory, 0o700);
  const database = openEngagementDatabase({ dataDirectory: directory });
  let minute = 0;
  const repository = new EngagementRepository(database.db, {
    createId: () => NOTES_ID,
    now: () => new Date(Date.UTC(2026, 7, 12, 12, minute++)),
  });
  const fixture = { directory, database, repository };
  fixtures.push(fixture);
  return fixture;
}

function createEngagement(repository: EngagementRepository) {
  const result = repository.createEngagement({
    name: "Notes lab",
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

describe("engagement notes persistence", () => {
  it("returns an empty document before the first save", () => {
    const { repository } = createFixture();
    const engagement = createEngagement(repository);

    expect(repository.getEngagementNotes(engagement.id)).toEqual({
      ok: true,
      value: {
        engagementId: engagement.id,
        markdown: "",
        updatedAt: engagement.updatedAt,
      },
    });
  });

  it("round-trips markdown with last-write-wins", () => {
    const { repository } = createFixture();
    const engagement = createEngagement(repository);

    const first = repository.putEngagementNotes(engagement.id, {
      markdown: "# creds\nadmin / secret",
    });
    expect(first).toMatchObject({ ok: true, value: { markdown: "# creds\nadmin / secret" } });
    const second = repository.putEngagementNotes(engagement.id, {
      markdown: "# updated\nflag{second}",
    });
    if (!second.ok) throw new Error(`Fixture save failed: ${second.error.code}`);

    expect(repository.getEngagementNotes(engagement.id)).toEqual({
      ok: true,
      value: second.value,
    });
  });

  it("rejects oversize markdown and unknown engagements without storing", () => {
    const { repository } = createFixture();
    const engagement = createEngagement(repository);

    expect(
      repository.putEngagementNotes(engagement.id, {
        markdown: "a".repeat(65_537),
      }),
    ).toEqual({ ok: false, error: { code: "invalid_repository_input" } });
    expect(
      repository.putEngagementNotes(UNKNOWN_ID, { markdown: "# notes" }),
    ).toEqual({ ok: false, error: { code: "engagement_not_found" } });
    expect(repository.getEngagementNotes(UNKNOWN_ID)).toEqual({
      ok: false,
      error: { code: "engagement_not_found" },
    });
    expect(repository.getEngagementNotes(engagement.id)).toMatchObject({
      ok: true,
      value: { markdown: "" },
    });
  });
});
