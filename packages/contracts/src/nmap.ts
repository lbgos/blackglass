import { z } from "zod";

import { EvidenceDigestSchema, OpaqueArtifactIdSchema } from "./evidence.js";
import { EngagementSchema } from "./engagement.js";
import { ScopePortRangeSchema, type ScopePortRange } from "./saved-scope.js";

/**
 * T1 Nmap TCP connect options contract.
 * Strict typed surface for the first-party Nmap discovery profile.
 * No raw flags, no script/NSE, no privileged modes, no arbitrary output path.
 * XML output path is trusted host state and is never an operator option.
 */

export const NmapTimingTemplateSchema = z.enum(["T0", "T1", "T2", "T3", "T4", "T5"]);

export type NmapTimingTemplate = z.infer<typeof NmapTimingTemplateSchema>;

// Bounded duration: 1 second through 24 hours as finite seconds, null means unlimited
// where the host can support it (delegated cgroup v2). ADR-0002 limits are 1s..24h.
export const NmapDurationSecondsSchema = z.number().int().min(1).max(86_400).nullable();

export const NmapTcpConnectOptionsSchema = z.strictObject({
  // Optional normalized port/ranges. When omitted no -p is emitted.
  // Each entry is inclusive from/to. Single port is {from:80,to:80}.
  ports: z.array(ScopePortRangeSchema).min(1).max(256).optional(),
  serviceDetection: z.boolean(),
  timingTemplate: NmapTimingTemplateSchema,
  skipHostDiscovery: z.boolean(),
  versionIntensity: z.number().int().min(0).max(9),
  maxRetries: z.number().int().min(0).max(10),
  // Bounded duration for the action; null requests unlimited where host supports it.
  durationSeconds: NmapDurationSecondsSchema.optional(),
});

export type NmapTcpConnectOptions = z.infer<typeof NmapTcpConnectOptionsSchema>;

// Established capability error shape reused from D2 process supervision fixtures.
// Do not invent a second action state machine; validation failures surface as
// strict schema rejections and the domain builder maps privileged attempts to this.
export const NmapCapabilityErrorCodeSchema = z.enum([
  "nmap_capability_unsupported",
  "invalid_nmap_action_contract",
]);

export type NmapCapabilityErrorCode = z.infer<typeof NmapCapabilityErrorCodeSchema>;

export const NmapCapabilityErrorSchema = z.strictObject({
  code: NmapCapabilityErrorCodeSchema,
});

export type NmapCapabilityError = z.infer<typeof NmapCapabilityErrorSchema>;

// Re-export canonical type for consumers that need port-range shape without redefining it.
export type { ScopePortRange as NmapPortRange };
export const NMAP_PARSER_VERSION = "nmap-xml-v1" as const;
export const NMAP_MAX_XML_BYTES = 16 * 1024 * 1024;
export const NMAP_MAX_HOSTS = 2048;
export const NMAP_MAX_SERVICES = 8192;
export const NmapParserVersionSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/);
const BoundedString = (min: number, max: number) => z.string().min(min).max(max);
const BoundedNullableString = (max: number) => z.string().min(1).max(max).nullable();
export const NmapServiceObservationSchema = z.strictObject({
  address: BoundedString(1, 45),
  port: z.number().int().min(1).max(65_535),
  protocol: z.literal("tcp"),
  hostname: BoundedNullableString(253),
  serviceName: BoundedNullableString(64),
  product: BoundedNullableString(64),
  version: BoundedNullableString(64),
});
export const NmapProjectedServiceSchema = NmapServiceObservationSchema.extend({
  source: z.literal("nmap"),
  parserVersion: NmapParserVersionSchema,
  runId: z.string().min(1).max(255),
  artifactId: OpaqueArtifactIdSchema,
  artifactDigest: EvidenceDigestSchema,
  observedAt: z.iso.datetime({ offset: true }),
});
export const EngagementServicesParamsSchema = z.strictObject({ engagementId: EngagementSchema.shape.id });
export const EngagementServicesResponseSchema = z.array(NmapProjectedServiceSchema);
export const NmapParseErrorCodeSchema = z.literal("nmap_xml_invalid");
export type NmapServiceObservation = z.infer<typeof NmapServiceObservationSchema>;
export type NmapProjectedService = z.infer<typeof NmapProjectedServiceSchema>;
export type EngagementServicesParams = z.infer<typeof EngagementServicesParamsSchema>;
