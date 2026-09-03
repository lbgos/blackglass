import { z } from "zod";

import { EngagementSchema } from "./engagement.js";
import {
  EvidenceDigestSchema,
  OpaqueArtifactIdSchema,
  PublishedCompletenessSchema,
} from "./evidence.js";
import {
  RunStateSchema,
  RunTerminalKindSchema,
  RunTerminalReasonSchema,
} from "./runner-control.js";

// Strict response caps for preserved raw output viewing. The control plane
// never streams unbounded bytes: each stream returns at most this many raw
// bytes decoded as text, with a truthful truncated flag when the artifact is
// larger.
export const RUN_OUTPUT_MAX_BYTES = 64 * 1024;
export const RUN_OUTPUT_MAX_CONTENT_CHARS = 64 * 1024;

const RunIdentifierSchema = z.string().min(1).max(255);

export const RunOutputParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
  runId: RunIdentifierSchema,
});

export const LatestRunOutputParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
});

export const RunOutputStreamAbsentSchema = z.strictObject({
  present: z.literal(false),
  truncated: z.literal(false),
  content: z.literal(""),
});

export const RunOutputStreamPresentSchema = z.strictObject({
  present: z.literal(true),
  artifactId: OpaqueArtifactIdSchema,
  sizeBytes: z.number().int().safe().nonnegative(),
  digest: EvidenceDigestSchema,
  completeness: PublishedCompletenessSchema,
  truncated: z.boolean(),
  content: z.string().max(RUN_OUTPUT_MAX_CONTENT_CHARS),
});

export const RunOutputStreamSchema = z.union([
  RunOutputStreamAbsentSchema,
  RunOutputStreamPresentSchema,
]);

export const RunOutputRunSchema = z.strictObject({
  id: RunIdentifierSchema,
  actionId: RunIdentifierSchema,
  state: RunStateSchema,
  terminalKind: RunTerminalKindSchema.nullable(),
  terminalReason: RunTerminalReasonSchema.nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const RunOutputResponseSchema = z.strictObject({
  run: RunOutputRunSchema,
  stdout: RunOutputStreamSchema,
  stderr: RunOutputStreamSchema,
});

export const RunOutputErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("run_not_found") }),
  z.strictObject({ code: z.literal("no_terminal_run") }),
  z.strictObject({ code: z.literal("missing_artifact") }),
  z.strictObject({ code: z.literal("corrupt_artifact") }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export type RunOutputParams = z.infer<typeof RunOutputParamsSchema>;
export type LatestRunOutputParams = z.infer<typeof LatestRunOutputParamsSchema>;
export type RunOutputStream = z.infer<typeof RunOutputStreamSchema>;
export type RunOutputResponse = z.infer<typeof RunOutputResponseSchema>;
export type RunOutputError = z.infer<typeof RunOutputErrorSchema>;

const OPERATOR_RUN_OUTPUT_ROUTE_PATTERNS = [
  /^\/api\/v1\/engagements\/[^/]+\/runs\/[^/]+\/output$/,
  /^\/api\/v1\/engagements\/[^/]+\/runs\/latest\/output$/,
];

// Exact operator run-output route matcher used by the auth hook to refuse
// runner credentials on operator-only output reads. Query strings ignored.
export function isOperatorRunOutputRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return OPERATOR_RUN_OUTPUT_ROUTE_PATTERNS.some((pattern) => pattern.test(path));
}
