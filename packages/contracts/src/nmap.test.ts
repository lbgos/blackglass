import { describe, expect, it } from "vitest";

import { NmapTcpConnectOptionsSchema } from "./nmap.js";

const validBase = {
  serviceDetection: true,
  timingTemplate: "T4" as const,
  skipHostDiscovery: true,
  versionIntensity: 7,
  maxRetries: 2,
} as const;

describe("NmapTcpConnectOptionsSchema strict T1 contract", () => {
  it("accepts minimal valid profile without ports or duration", () => {
    const parsed = NmapTcpConnectOptionsSchema.safeParse({ ...validBase });
    expect(parsed.success).toBe(true);
  });

  it("accepts all timing templates T0-T5", () => {
    for (const t of ["T0", "T1", "T2", "T3", "T4", "T5"] as const) {
      expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, timingTemplate: t }).success).toBe(true);
    }
  });

  it("rejects T6 and lowercase timing", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, timingTemplate: "T6" as unknown as string }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, timingTemplate: "t4" as unknown as string }).success).toBe(false);
  });

  it("accepts port ranges via reused ScopePortRangeSchema", () => {
    const input = NmapTcpConnectOptionsSchema.safeParse({
      ...validBase,
      ports: [
        { from: 443, to: 443 },
        { from: 80, to: 80 },
      ],
    });
    expect(input.success).toBe(true);
  });

  it("rejects inverted, zero, and out-of-range ports", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, ports: [{ from: 100, to: 80 }] }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, ports: [{ from: 0, to: 80 }] }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, ports: [{ from: 1, to: 70_000 }] }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, ports: [{ from: 1.5, to: 80 }] }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, ports: [] }).success).toBe(false);
  });

  it("enforces versionIntensity 0-9 and maxRetries 0-10", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, versionIntensity: 9 }).success).toBe(true);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, versionIntensity: 0 }).success).toBe(true);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, versionIntensity: 10 }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, versionIntensity: -1 }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, maxRetries: 10 }).success).toBe(true);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, maxRetries: 11 }).success).toBe(false);
  });

  it("enforces bounded duration 1..86400 and null unlimited", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, durationSeconds: 1800 }).success).toBe(true);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, durationSeconds: null }).success).toBe(true);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, durationSeconds: 0 }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, durationSeconds: 86_401 }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, durationSeconds: 1.5 as unknown as number }).success).toBe(false);
  });

  it("rejects unknown fields: rawFlags, script, outputPath", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, rawFlags: ["--script", "vuln"] } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, script: "vuln" } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, outputPath: "/tmp/foo.xml" } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, nse: true } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, argv: ["-sV"] } as unknown as object).success).toBe(false);
  });

  it("rejects privileged scan modes", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, synScan: true } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, osDetection: true } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, scanType: "S" } as unknown as object).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, privileged: true } as unknown as object).success).toBe(false);
  });

  it("rejects injection-shaped raw values in ports at schema layer", () => {
    expect(
      NmapTcpConnectOptionsSchema.safeParse({
        ...validBase,
        ports: [{ from: 80, to: 80, extra: "; rm -rf /" }] as unknown as object,
      }).success,
    ).toBe(false);
  });

  it("requires strict booleans and rejects stringified booleans", () => {
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, serviceDetection: "true" as unknown as boolean }).success).toBe(false);
    expect(NmapTcpConnectOptionsSchema.safeParse({ ...validBase, skipHostDiscovery: 1 as unknown as boolean }).success).toBe(false);
  });

  it("accepts duration omitted (undefined) as valid", () => {
    const p = NmapTcpConnectOptionsSchema.safeParse({ ...validBase, durationSeconds: undefined });
    expect(p.success).toBe(true);
  });
});
