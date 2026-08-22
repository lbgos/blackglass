import { z } from "zod";

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
