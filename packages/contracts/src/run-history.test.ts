import { describe, expect, it } from "vitest";

import {
  decodeRunHistoryCursor,
  encodeRunHistoryCursor,
  isOperatorRunHistoryRoute,
  parseRunHistoryQuery,
  RUN_HISTORY_CURSOR_MAX_LENGTH,
  RUN_HISTORY_DEFAULT_LIMIT,
  RUN_HISTORY_MAX_LIMIT,
  RunHistoryErrorSchema,
  RunHistoryResponseSchema,
  RunHistorySummarySchema,
} from "./run-history.js";

const ENGAGEMENT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT_ID = "10000000-0000-4000-8000-000000000002";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "run:action-1:1",
    actionId: "action-1",
    state: "succeeded",
    terminalKind: "succeeded",
    terminalReason: null,
    updatedAt: "2026-08-09T12:01:00.000Z",
    createdAt: "2026-08-09T12:00:00.000Z",
    attempt: 1,
    ...overrides,
  };
}

describe("run history contracts", () => {
  it("projects exactly the public summary fields", () => {
    expect(RunHistorySummarySchema.safeParse(summary()).success).toBe(true);
    expect(
      RunHistorySummarySchema.safeParse({ ...summary(), currentLeaseId: "l" })
        .success,
    ).toBe(false);
    expect(
      RunHistorySummarySchema.safeParse({ ...summary(), currentFence: "1" })
        .success,
    ).toBe(false);
    expect(
      RunHistorySummarySchema.safeParse({ ...summary(), engagementId: ENGAGEMENT_ID })
        .success,
    ).toBe(false);
    for (const state of [
      "queued",
      "leased",
      "running",
      "cancel_requested",
      "succeeded",
      "failed",
      "cancelled",
    ] as const) {
      const terminal = state === "succeeded" || state === "failed" || state === "cancelled";
      const candidate = summary({
        state,
        terminalKind: terminal ? state : null,
        terminalReason: terminal && state !== "succeeded" ? "operator_cancelled" : null,
      });
      expect(RunHistorySummarySchema.safeParse(candidate).success).toBe(true);
    }
    expect(
      RunHistorySummarySchema.safeParse(summary({ attempt: 0 })).success,
    ).toBe(false);
    const response = { runs: [summary()], nextCursor: null };
    expect(RunHistoryResponseSchema.safeParse(response).success).toBe(true);
    for (const code of [
      "invalid_request",
      "engagement_not_found",
      "invalid_persisted_data",
      "storage_busy",
    ] as const) {
      expect(RunHistoryErrorSchema.safeParse({ code }).success).toBe(true);
    }
  });

  it("round-trips the cursor while preserving timestamps exactly", () => {
    const createdAt = "2026-08-09T12:00:00.000Z";
    const cursor = encodeRunHistoryCursor({
      engagementId: ENGAGEMENT_ID,
      createdAt,
      id: "run:action-1:2",
    });
    expect(cursor.length).toBeLessThanOrEqual(RUN_HISTORY_CURSOR_MAX_LENGTH);
    expect(decodeRunHistoryCursor(cursor, ENGAGEMENT_ID)).toEqual({
      ok: true,
      value: { createdAt, id: "run:action-1:2" },
    });
  });

  it("rejects malformed, cross-engagement, and oversized cursors", () => {
    const valid = encodeRunHistoryCursor({
      engagementId: ENGAGEMENT_ID,
      createdAt: "2026-08-09T12:00:00.000Z",
      id: "run-1",
    });
    expect(decodeRunHistoryCursor(valid, OTHER_ENGAGEMENT_ID)).toEqual({ ok: false });
    expect(decodeRunHistoryCursor("not base64!!", ENGAGEMENT_ID)).toEqual({
      ok: false,
    });
    expect(decodeRunHistoryCursor("", ENGAGEMENT_ID)).toEqual({ ok: false });
    expect(decodeRunHistoryCursor("a", ENGAGEMENT_ID)).toEqual({ ok: false });
    expect(
      decodeRunHistoryCursor(`x`.repeat(RUN_HISTORY_CURSOR_MAX_LENGTH + 1), ENGAGEMENT_ID),
    ).toEqual({ ok: false });
    const wrongVersion = Buffer.from(
      JSON.stringify({
        v: 2,
        engagementId: ENGAGEMENT_ID,
        createdAt: "2026-08-09T12:00:00.000Z",
        id: "run-1",
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeRunHistoryCursor(wrongVersion, ENGAGEMENT_ID)).toEqual({
      ok: false,
    });
    const extraField = Buffer.from(
      JSON.stringify({
        v: 1,
        engagementId: ENGAGEMENT_ID,
        createdAt: "2026-08-09T12:00:00.000Z",
        id: "run-1",
        extra: true,
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeRunHistoryCursor(extraField, ENGAGEMENT_ID)).toEqual({
      ok: false,
    });
    const nonCanonical = `${valid}=`;
    expect(decodeRunHistoryCursor(nonCanonical, ENGAGEMENT_ID)).toEqual({
      ok: false,
    });
  });

  it("parses limit strictly with default 25 and max 100", () => {
    expect(RUN_HISTORY_DEFAULT_LIMIT).toBe(25);
    expect(RUN_HISTORY_MAX_LIMIT).toBe(100);
    expect(parseRunHistoryQuery({})).toEqual({ ok: true, value: { limit: 25 } });
    expect(parseRunHistoryQuery({ limit: "1" })).toEqual({
      ok: true,
      value: { limit: 1 },
    });
    expect(parseRunHistoryQuery({ limit: "100" })).toEqual({
      ok: true,
      value: { limit: 100 },
    });
    for (const query of [
      { limit: "" },
      { limit: "0" },
      { limit: "101" },
      { limit: "2.5" },
      { limit: "25.0" },
      { limit: "+25" },
      { limit: " 25" },
      { limit: "25 " },
      { limit: ["25"] },
      { limit: ["25", "25"] },
      { limit: 25 },
      { before: "" },
      { before: ["x"] },
      { limit: "25", unknown: "1" },
      { cursor: "x" },
    ]) {
      expect(parseRunHistoryQuery(query)).toEqual({ ok: false });
    }
  });

  it("matches only the operator run history route", () => {
    expect(isOperatorRunHistoryRoute(`/api/v1/engagements/${ENGAGEMENT_ID}/runs`)).toBe(
      true,
    );
    expect(
      isOperatorRunHistoryRoute(`/api/v1/engagements/${ENGAGEMENT_ID}/runs?limit=2`),
    ).toBe(true);
    expect(
      isOperatorRunHistoryRoute(
        `/api/v1/engagements/${ENGAGEMENT_ID}/runs?limit=2&before=abc`,
      ),
    ).toBe(true);
    expect(
      isOperatorRunHistoryRoute(`/api/v1/engagements/${ENGAGEMENT_ID}/runs/latest/output`),
    ).toBe(false);
    expect(
      isOperatorRunHistoryRoute(`/api/v1/engagements/${ENGAGEMENT_ID}/runs/r/output`),
    ).toBe(false);
    expect(isOperatorRunHistoryRoute("/api/v1/engagements")).toBe(false);
  });
});
