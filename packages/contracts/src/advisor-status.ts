import { z } from "zod";

/**
 * Advisor connection status contract.
 * The control plane reports whether the advisor is configured (endpoint plus
 * model stored) and whether the endpoint answers a minimal live probe. No
 * model calls, no chat turns, no capabilities in this slice.
 *
 * Key material never appears here. Only present/absent booleans and the key
 * env var NAME (already served by the settings endpoint) leave the plane.
 * The endpoint is exposed as a bare host, never as a full URL. Strict Zod,
 * no passthrough.
 */

export const ADVISOR_STATUS_REASONS = [
  "unconfigured",
  "missing_key_env",
  "key_unset",
  "public_not_opted_in",
  "unreachable",
  "probe_failed",
  "ok",
] as const;

export const AdvisorStatusReasonSchema = z.enum(ADVISOR_STATUS_REASONS);

export type AdvisorStatusReason = z.infer<typeof AdvisorStatusReasonSchema>;

// endpointReachable is null when no probe was attempted (unconfigured,
// missing key reference, unset key, or a public endpoint without opt-in),
// false when a probe ran and the endpoint did not answer, true on any HTTP
// response. latencyMs is null unless a probe ran to completion.
export const AdvisorStatusSchema = z.strictObject({
  configured: z.boolean(),
  endpointReachable: z.boolean().nullable(),
  modelId: z.string(),
  endpointHost: z.string(),
  publicEndpoint: z.boolean(),
  optIn: z.boolean(),
  keyEnvVar: z.string(),
  keyPresent: z.boolean(),
  latencyMs: z.number().int().min(0).nullable(),
  reason: AdvisorStatusReasonSchema,
});

export type AdvisorStatus = z.infer<typeof AdvisorStatusSchema>;

// Outcome of one minimal endpoint probe: a plain GET with no auth header
// and no payload. reachable is true on any HTTP response.
export const ConnectionTestResultSchema = z.strictObject({
  reachable: z.boolean(),
  latencyMs: z.number().int().min(0),
});

export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;
