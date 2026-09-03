import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_NOTES_MAX_BYTES,
  EngagementNotesResponseSchema,
  UpdateEngagementNotesRequestSchema,
} from "./engagement-notes.js";

const engagementId = "10000000-0000-4000-8000-000000000001";

describe("engagement notes contracts", () => {
  it("accepts empty and max-size markdown with an updated timestamp", () => {
    expect(
      UpdateEngagementNotesRequestSchema.parse({ markdown: "" }),
    ).toEqual({ markdown: "" });
    const max = "a".repeat(ENGAGEMENT_NOTES_MAX_BYTES);
    expect(UpdateEngagementNotesRequestSchema.parse({ markdown: max })).toEqual({
      markdown: max,
    });
    expect(
      EngagementNotesResponseSchema.parse({
        engagementId,
        markdown: "# notes",
        updatedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toMatchObject({ engagementId, markdown: "# notes" });
  });

  it("rejects oversize bodies and unknown fields", () => {
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "a".repeat(ENGAGEMENT_NOTES_MAX_BYTES + 1),
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({
        markdown: "# notes",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      EngagementNotesResponseSchema.safeParse({
        engagementId,
        markdown: "# notes",
      }).success,
    ).toBe(false);
  });

  it("enforces the byte limit for multibyte markdown", () => {
    const over = "あ".repeat(21_846);
    expect(new TextEncoder().encode(over).length).toBeGreaterThan(
      ENGAGEMENT_NOTES_MAX_BYTES,
    );
    expect(
      UpdateEngagementNotesRequestSchema.safeParse({ markdown: over }).success,
    ).toBe(false);
  });
});
