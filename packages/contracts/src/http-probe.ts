import { z } from "zod";

import { EvidenceDigestSchema, OpaqueArtifactIdSchema } from "./evidence.js";
import { EngagementSchema } from "./engagement.js";

/**
 * Minimal HTTP probe contract.
 * One URL plus its redirect chain (max 5 hops). No rendering, no auth,
 * no crawling. Raw evidence is a bounded JSON document stored as tool_raw.
 */

export const HTTP_PROBE_PARSER_VERSION = "http-probe-raw-v1" as const;
export const HTTP_PROBE_MAX_HOPS = 5;
export const HTTP_PROBE_MAX_RAW_BYTES = 262_144;
export const HTTP_PROBE_MAX_BODY_BYTES = 65_536;
export const HTTP_PROBE_MAX_TITLE_CHARS = 256;
export const HTTP_PROBE_ARTIFACT_SLOT = "http-probe-raw" as const;

export const HttpProbeParserVersionSchema = z.literal(HTTP_PROBE_PARSER_VERSION);

const ProbeUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    { message: "probe url must be http or https" },
  );

const HeaderValueSchema = z.string().min(1).max(1024).nullable();

export const HttpProbeSelectedHeadersSchema = z.strictObject({
  contentType: HeaderValueSchema,
  server: HeaderValueSchema,
  poweredBy: HeaderValueSchema,
});

export type HttpProbeSelectedHeaders = z.infer<typeof HttpProbeSelectedHeadersSchema>;

export const HttpProbeHopSchema = z.strictObject({
  url: ProbeUrlSchema,
  status: z.number().int().min(100).max(599),
  location: z.string().min(1).max(2048).nullable(),
});

export type HttpProbeHop = z.infer<typeof HttpProbeHopSchema>;

export const HttpProbeErrorCodeSchema = z.enum([
  "fetch_failed",
  "timeout",
  "too_many_redirects",
  "invalid_redirect",
  "body_too_large",
]);

export type HttpProbeErrorCode = z.infer<typeof HttpProbeErrorCodeSchema>;

export const HttpProbeRawSchema = z.strictObject({
  parserVersion: HttpProbeParserVersionSchema,
  url: ProbeUrlSchema,
  fetchedAt: z.iso.datetime({ offset: true }),
  finalUrl: ProbeUrlSchema,
  status: z.number().int().min(100).max(599).nullable(),
  title: z.string().min(1).max(HTTP_PROBE_MAX_TITLE_CHARS).nullable(),
  selectedHeaders: HttpProbeSelectedHeadersSchema,
  // Empty when the fetch itself failed before any HTTP status was observed.
  hops: z.array(HttpProbeHopSchema).min(0).max(HTTP_PROBE_MAX_HOPS + 1),
  error: HttpProbeErrorCodeSchema.nullable(),
});

export type HttpProbeRaw = z.infer<typeof HttpProbeRawSchema>;

export const HttpProbeProjectedSchema = HttpProbeRawSchema.extend({
  source: z.literal("http-probe"),
  runId: z.string().min(1).max(255),
  artifactId: OpaqueArtifactIdSchema,
  artifactDigest: EvidenceDigestSchema,
  observedAt: z.iso.datetime({ offset: true }),
});

export type HttpProbeProjected = z.infer<typeof HttpProbeProjectedSchema>;

export function isHttpProbeArtifactSlot(slot: string): boolean {
  return slot === HTTP_PROBE_ARTIFACT_SLOT || slot.startsWith(`${HTTP_PROBE_ARTIFACT_SLOT}-`);
}

export const EngagementHttpProbesParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
});
export const EngagementHttpProbesResponseSchema = z.array(HttpProbeProjectedSchema);

export type EngagementHttpProbesParams = z.infer<typeof EngagementHttpProbesParamsSchema>;
