import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_NOTES_MAX_BYTES,
  EngagementNotesResponseSchema,
  UpdateEngagementNotesErrorSchema,
  UpdateEngagementNotesRequestSchema,
} from "./engagement-notes.js";

const engagementId = "10000000-0000-4000-8000-000000000001";

describe("engagement notes contracts", () => {
  it("accepts empty and max-size markdown with revision and timestamp", () => {
    expect(
      UpdateEngagementNotesRequestSchema.parse({ markdown: "", expectedRevision: 0 }),
    ).toEqual({ markdown: "", expectedRevision: 0 });
    const max = "a".repeat(ENGAGEMENT_NOTES_MAX_BYTES);
    expect(
      UpdateEngagementNotesRequestSchema.parse({ markdown: max, expectedRevision: 2 }),
    ).toEqual({
      markdown: max,
      expectedRevision: 2,
    });
    expect(
      EngagementNotesResponseSchema.parse({
        engagementId,
        markdown: "# notes",
        updatedAt: "2026-08-12T12:00:00.000Z",
        revision: 0,
      }),
    ).toMatchObject({ engagementId, markdown: "# notes", revision: 0 });
    expect(
      EngagementNotesResponseSchema.parse({
        engagementId,
        markdown: "# notes",
        updatedAt: "2026-08-12T12:00:00.000Z",
        revision: 3,
      }),
    ).toMatchObject({ revision: 3 });
  });

  it("rejects oversize bodies, unsafe revisions, and unknown fields", () => {
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "a".repeat(ENGAGEMENT_NOTES_MAX_BYTES + 1),
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({ markdown: "# notes" }).success,
    ).toBe(false);
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "# notes",
        expectedRevision: -1,
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "# notes",
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "# notes",
        expectedRevision: 1.5,
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "# notes",
        expectedRevision: 0,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      EngagementNotesResponseSchema.safeParse({
        engagementId,
        markdown: "# notes",
        updatedAt: "2026-08-12T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("enforces the byte limit for multibyte markdown", () => {
    const over = "あ".repeat(21_846);
    expect(new TextEncoder().encode(over).length).toBeGreaterThan(
      ENGAGEMENT_NOTES_MAX_BYTES,
    );
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({ markdown: over, expectedRevision: 0 })
        .success,
    ).toBe(false);
  });

  it("parses the minimal notes conflict error", () => {
    expect(
      UpdateEngagementNotesErrorSchema.parse({
        code: "revision_conflict",
        resourceType: "engagement_notes",
        resourceId: engagementId,
        currentRevision: 1,
      }),
    ).toMatchObject({ code: "revision_conflict", currentRevision: 1 });
    expect(
      UpdateEngagementNotesErrorSchema.safeParse({
        code: "revision_conflict",
        resourceType: "engagement",
        resourceId: engagementId,
        currentRevision: 1,
      }).success,
    ).toBe(false);
  });
});
