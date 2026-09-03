import { z } from "zod";

import { EngagementSchema } from "./engagement.js";
import { EvidenceDigestSchema, OpaqueArtifactIdSchema } from "./evidence.js";

/**
 * Slice 1 ffuf content-discovery contract.
 * Typed options plus the JSON parser contract. Strict Zod, no passthrough.
 * Slice 2 wires it into the operator flow: launch validation, snapshot
 * marker options, the ffuf-json evidence slot, and projected results.
 * The settings store backend stays out of scope: the wordlist path remains
 * an explicit operator input validated here.
 */

export const FFUF_PARSER_VERSION = "ffuf-json-v1" as const;
export const FFUF_MAX_RESULTS = 100_000;
/** Guard against unbounded JSON reads; ffuf output scales with the wordlist. */
export const FFUF_MAX_JSON_BYTES = 64 * 1024 * 1024;
export const FFUF_DEFAULT_MATCH_CODES = [200, 204, 301, 302, 307, 308, 401, 403] as const;

function isHttpOrigin(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") && !value.includes("\0");
}

function hasPathTraversal(value: string): boolean {
  return value.split("/").includes("..");
}

const AbsoluteManagedPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isAbsolutePath, { message: "path must be absolute" })
  .refine((value) => !hasPathTraversal(value), { message: "path traversal rejected" });

export const FfufActionOptionsSchema = z.strictObject({
  origin: z
    .string()
    .min(1)
    .max(2048)
    .refine(isHttpOrigin, { message: "origin must be http or https" }),
  wordlistPath: AbsoluteManagedPathSchema,
  outputJsonPath: AbsoluteManagedPathSchema,
  // Accepted and validated here for forward compatibility with ffuf v2.
  // ffuf 1.1.0 rejects -rate, so the argv builder never emits it.
  rate: z.number().int().min(1).max(10_000).default(100),
  threads: z.number().int().min(1).max(200).default(40),
  timeoutSeconds: z.number().int().min(1).max(120).default(10),
  maxTimeSeconds: z.number().int().min(5).max(1800).default(120),
  matchStatusCodes: z
    .array(z.number().int().min(100).max(599))
    .min(1)
    .default([...FFUF_DEFAULT_MATCH_CODES]),
});

export type FfufActionOptions = z.infer<typeof FfufActionOptionsSchema>;

/**
 * One normalized ffuf JSON output record.
 * Mirrors ffuf -of json field names; extra raw keys (position, host,
 * resultfile) are dropped by projection before validation, never passed through.
 */
export const FfufJsonResultSchema = z.strictObject({
  url: z.string().min(1).max(2048),
  status: z.number().int().min(100).max(599),
  length: z.number().int().min(0),
  words: z.number().int().min(0),
  lines: z.number().int().min(0),
  redirectlocation: z.string().min(1).max(2048).optional(),
  input: z.strictObject({
    FUZZ: z.string().min(1).max(2048),
  }),
});

export type FfufJsonResult = z.infer<typeof FfufJsonResultSchema>;

export const FfufDiscoveryOutputSchema = z.strictObject({
  results: z.array(FfufJsonResultSchema).max(FFUF_MAX_RESULTS),
  truncated: z.boolean(),
});

export type FfufDiscoveryOutput = z.infer<typeof FfufDiscoveryOutputSchema>;

export const FfufErrorCodeSchema = z.enum([
  "invalid_ffuf_action_contract",
  "ffuf_missing",
  "ffuf_parse_error",
]);

export type FfufErrorCode = z.infer<typeof FfufErrorCodeSchema>;

export const FfufDiscoveryErrorSchema = z.strictObject({
  code: FfufErrorCodeSchema,
});

export type FfufDiscoveryError = z.infer<typeof FfufDiscoveryErrorSchema>;

/**
 * Slice 2 operator surface.
 * The JSON output path is trusted host state derived by the runner from its
 * controlled run directory, so it is never an operator option. Everything
 * else stays validated here, including the explicit wordlist path.
 */
export const FfufDiscoveryOptionsSchema = FfufActionOptionsSchema.omit({
  outputJsonPath: true,
});

export type FfufDiscoveryOptions = z.infer<typeof FfufDiscoveryOptionsSchema>;

export const FfufDiscoveryLaunchSchema = z.strictObject({
  expectedEngagementRevision: z.number().int().positive(),
  expectedActiveScopeRevisionId: EngagementSchema.shape.id.nullable(),
  origin: FfufDiscoveryOptionsSchema.shape.origin,
  wordlistPath: FfufDiscoveryOptionsSchema.shape.wordlistPath,
  rate: FfufDiscoveryOptionsSchema.shape.rate,
  threads: FfufDiscoveryOptionsSchema.shape.threads,
  timeoutSeconds: FfufDiscoveryOptionsSchema.shape.timeoutSeconds,
  maxTimeSeconds: FfufDiscoveryOptionsSchema.shape.maxTimeSeconds,
  matchStatusCodes: FfufDiscoveryOptionsSchema.shape.matchStatusCodes,
});

export type FfufDiscoveryLaunch = z.infer<typeof FfufDiscoveryLaunchSchema>;

/** Raw ffuf -of json output is preserved as tool_raw under this slot. */
export const FFUF_ARTIFACT_SLOT = "ffuf-json" as const;

export function isFfufArtifactSlot(slot: string): boolean {
  return slot === FFUF_ARTIFACT_SLOT;
}

export const FfufParserVersionSchema = z.literal(FFUF_PARSER_VERSION);

export const FfufProjectedSchema = z.strictObject({
  source: z.literal("ffuf"),
  parserVersion: FfufParserVersionSchema,
  url: z.string().min(1).max(2048),
  status: z.number().int().min(100).max(599),
  length: z.number().int().min(0),
  words: z.number().int().min(0),
  lines: z.number().int().min(0),
  redirectlocation: z.string().min(1).max(2048).nullable(),
  fuzz: z.string().min(1).max(2048),
  runId: z.string().min(1).max(255),
  artifactId: OpaqueArtifactIdSchema,
  artifactDigest: EvidenceDigestSchema,
  observedAt: z.iso.datetime({ offset: true }),
});

export type FfufProjected = z.infer<typeof FfufProjectedSchema>;

export const EngagementFfufResultsParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
});
export const EngagementFfufResultsResponseSchema = z.array(FfufProjectedSchema);

export type EngagementFfufResultsParams = z.infer<typeof EngagementFfufResultsParamsSchema>;
