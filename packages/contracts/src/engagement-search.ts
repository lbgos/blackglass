import { z } from "zod";

import { EngagementSchema } from "./engagement.js";

/**
 * STONE-6 engagement-wide search contracts.
 * Covers targets, hostnames, notes, leads, findings, artifact names, and
 * indexed excerpts. Grouped by type with a snippet that opens the exact
 * context. Unindexed material is labeled, never silently dropped. Secrets
 * are excluded: secret values are never indexed and snippets are redacted.
 */

export const ENGAGEMENT_SEARCH_QUERY_MAX_CHARS = 120 as const;
export const ENGAGEMENT_SEARCH_MAX_PER_GROUP = 10 as const;
export const ENGAGEMENT_SEARCH_SNIPPET_MAX_CHARS = 200 as const;

export const EngagementSearchResultKindSchema = z.enum([
  "target",
  "hostname",
  "note",
  "lead",
  "finding",
  "artifact",
  "excerpt",
]);

export type EngagementSearchResultKind = z.infer<typeof EngagementSearchResultKindSchema>;

/**
 * `anchor` opens the exact passage, not the top of the document.
 * Conventions per kind: `note:notes@<offset>` carries the character offset
 * of the match inside the notes text; `scope:<revisionId>:<ruleId>`
 * names the exact matched rule; `finding:<id>`, `service:<addr>:<port>`,
 * `probe:<url>`, and `artifact:<id>` name their entity; ffuf rows anchor as
 * `run:<runId>:fuzz:<keyword>` so one run with many rows still opens the
 * exact row.
 */
export const EngagementSearchResultSchema = z.strictObject({
  kind: EngagementSearchResultKindSchema,
  id: z.string().min(1).max(255),
  title: z.string().min(1).max(300),
  snippet: z.string().min(1).max(500),
  anchor: z.string().min(1).max(500),
  unindexed: z.boolean(),
});

export type EngagementSearchResult = z.infer<typeof EngagementSearchResultSchema>;

export const EngagementSearchResponseSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
  query: z.string().min(1).max(ENGAGEMENT_SEARCH_QUERY_MAX_CHARS),
  groups: z.record(
    EngagementSearchResultKindSchema,
    z.array(EngagementSearchResultSchema).max(ENGAGEMENT_SEARCH_MAX_PER_GROUP),
  ),
  unindexedKinds: z.array(EngagementSearchResultKindSchema),
});

export type EngagementSearchResponse = z.infer<typeof EngagementSearchResponseSchema>;

export const EngagementSearchErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export type EngagementSearchError = z.infer<typeof EngagementSearchErrorSchema>;

/** Strict `q` parsing: required, 1 to 120 chars after trim, `q` only. */
export function parseEngagementSearchQuery(
  query: unknown,
): { ok: true; value: { q: string } } | { ok: false } {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return { ok: false };
  }
  const record = query as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "q") return { ok: false };
  }
  const raw = record["q"];
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > ENGAGEMENT_SEARCH_QUERY_MAX_CHARS) {
    return { ok: false };
  }
  return { ok: true, value: { q: trimmed } };
}
