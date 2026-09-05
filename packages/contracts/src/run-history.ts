import { z } from "zod";

import { EngagementSchema } from "./engagement.js";
import {
  RunStateSchema,
  RunTerminalKindSchema,
  RunTerminalReasonSchema,
} from "./runner-control.js";

// Durable engagement run listing. Live keyset listing over persisted runs,
// newest createdAt first with stable id tie-break. Not a frozen snapshot:
// newly inserted newer runs and state updates never move already paged rows.
export const RUN_HISTORY_DEFAULT_LIMIT = 25 as const;
export const RUN_HISTORY_MAX_LIMIT = 100 as const;
export const RUN_HISTORY_CURSOR_VERSION = 1 as const;
export const RUN_HISTORY_CURSOR_MAX_LENGTH = 1024 as const;

const RunIdentifierSchema = z.string().min(1).max(255);

export const RunHistoryParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
});

export const RunHistorySummarySchema = z.strictObject({
  id: RunIdentifierSchema,
  actionId: RunIdentifierSchema,
  state: RunStateSchema,
  terminalKind: RunTerminalKindSchema.nullable(),
  terminalReason: RunTerminalReasonSchema.nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  attempt: z.number().int().safe().positive(),
});

export const RunHistoryResponseSchema = z.strictObject({
  runs: z.array(RunHistorySummarySchema).max(RUN_HISTORY_MAX_LIMIT),
  nextCursor: z.string().max(RUN_HISTORY_CURSOR_MAX_LENGTH).nullable(),
});

export const RunHistoryErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export type RunHistorySummary = z.infer<typeof RunHistorySummarySchema>;
export type RunHistoryResponse = z.infer<typeof RunHistoryResponseSchema>;
export type RunHistoryError = z.infer<typeof RunHistoryErrorSchema>;

// Versioned opaque cursor boundary. Carries the exact createdAt/id tuple and
// the engagement it was issued for. Input boundary only, never authorization,
// and unsigned by design.
export const RunHistoryCursorSchema = z.strictObject({
  v: z.literal(RUN_HISTORY_CURSOR_VERSION),
  engagementId: EngagementSchema.shape.id,
  createdAt: z.iso.datetime({ offset: true }),
  id: RunIdentifierSchema,
});

export type RunHistoryCursor = z.infer<typeof RunHistoryCursorSchema>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(cursor: string): Uint8Array {
  let base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = base64.length % 4;
  if (remainder === 1) throw new Error("invalid base64url length");
  if (remainder !== 0) base64 += "=".repeat(4 - remainder);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) as number;
  }
  return bytes;
}

export function encodeRunHistoryCursor(input: {
  engagementId: string;
  createdAt: string;
  id: string;
}): string {
  const payload = {
    v: RUN_HISTORY_CURSOR_VERSION,
    engagementId: input.engagementId,
    createdAt: input.createdAt,
    id: input.id,
  };
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeRunHistoryCursor(
  cursor: unknown,
  expectedEngagementId: string,
): { ok: true; value: { createdAt: string; id: string } } | { ok: false } {
  if (typeof cursor !== "string") return { ok: false };
  if (cursor.length === 0 || cursor.length > RUN_HISTORY_CURSOR_MAX_LENGTH) {
    return { ok: false };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return { ok: false };
  if (cursor.length % 4 === 1) return { ok: false };
  let json: string;
  try {
    json = new TextDecoder().decode(base64UrlToBytes(cursor));
  } catch {
    return { ok: false };
  }
  try {
    if (bytesToBase64Url(new TextEncoder().encode(json)) !== cursor) {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
  if (json.length > RUN_HISTORY_CURSOR_MAX_LENGTH) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  const validated = RunHistoryCursorSchema.safeParse(parsed);
  if (!validated.success) return { ok: false };
  if (validated.data.engagementId !== expectedEngagementId) return { ok: false };
  return {
    ok: true,
    value: { createdAt: validated.data.createdAt, id: validated.data.id },
  };
}

export interface ParsedRunHistoryQuery {
  readonly limit: number;
  readonly before?: string;
}

// Strict query parsing for the list endpoint. Only limit and before are
// known keys. Limit is a decimal integer string 1 through 100 with no
// clamping; empty, fractional, repeated (array), or unknown params fail.
// Before is validated as an opaque string here and decoded separately so
// cursor errors share the same invalid_request mapping.
export function parseRunHistoryQuery(
  query: unknown,
): { ok: true; value: ParsedRunHistoryQuery } | { ok: false } {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return { ok: false };
  }
  const record = query as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "limit" && key !== "before") return { ok: false };
  }
  let limit: number = RUN_HISTORY_DEFAULT_LIMIT;
  if ("limit" in record) {
    const raw = record["limit"];
    if (typeof raw !== "string") return { ok: false };
    if (raw.length === 0 || raw.length > 15) return { ok: false };
    if (!/^[0-9]+$/.test(raw)) return { ok: false };
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) return { ok: false };
    if (parsed < 1 || parsed > RUN_HISTORY_MAX_LIMIT) return { ok: false };
    limit = parsed;
  }
  if ("before" in record) {
    const raw = record["before"];
    if (typeof raw !== "string") return { ok: false };
    if (raw.length === 0 || raw.length > RUN_HISTORY_CURSOR_MAX_LENGTH) {
      return { ok: false };
    }
    return { ok: true, value: { limit, before: raw } };
  }
  return { ok: true, value: { limit } };
}

const OPERATOR_RUN_HISTORY_ROUTE_PATTERN =
  /^\/api\/v1\/engagements\/[^/]+\/runs$/;

// Exact operator run-history route matcher used by the auth hook to refuse
// runner credentials on the operator-only list read. Query strings ignored.
// Does not match the output subroutes, which keep their own matcher.
export function isOperatorRunHistoryRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return OPERATOR_RUN_HISTORY_ROUTE_PATTERN.test(path);
}
