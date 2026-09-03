import { z } from "zod";

/**
 * Slice 1 ffuf content-discovery contract.
 * Typed options plus the JSON parser contract. Strict Zod, no passthrough.
 * No API, DB, UI, or settings store in this slice.
 */

export const FFUF_PARSER_VERSION = "ffuf-json-v1" as const;
export const FFUF_MAX_RESULTS = 100_000;
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
