import { describe, expect, it } from "vitest";

import {
  GetSettingsResponseSchema,
  RUNNER_SETTINGS_DEFAULTS,
  RunnerSettingsSchema,
  SettingScopeSchema,
  UpdateSettingsRequestSchema,
} from "./settings.js";

describe("SettingScopeSchema", () => {
  it("accepts only the runner scope in this slice", () => {
    expect(SettingScopeSchema.safeParse("runner").success).toBe(true);
    for (const scope of ["general", "appearance", "advisor", "evidence", "diagnostics", ""]) {
      expect(SettingScopeSchema.safeParse(scope).success).toBe(false);
    }
  });
});

describe("RunnerSettingsSchema", () => {
  it("accepts the shipped defaults", () => {
    const parsed = RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        ffufBinaryPath: "/usr/bin/ffuf",
        ffufWordlistPath: "",
        ffufRate: 100,
        ffufThreads: 40,
        ffufTimeoutSeconds: 10,
        ffufMaxTimeSeconds: 120,
      });
    }
  });

  it("accepts an absolute wordlist path", () => {
    expect(
      RunnerSettingsSchema.safeParse({
        ...RUNNER_SETTINGS_DEFAULTS,
        ffufWordlistPath: "/usr/share/wordlists/common.txt",
      }).success,
    ).toBe(true);
  });

  it("rejects relative and traversal paths", () => {
    expect(
      RunnerSettingsSchema.safeParse({
        ...RUNNER_SETTINGS_DEFAULTS,
        ffufBinaryPath: "usr/bin/ffuf",
      }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({
        ...RUNNER_SETTINGS_DEFAULTS,
        ffufBinaryPath: "/usr/bin/../../ffuf",
      }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({
        ...RUNNER_SETTINGS_DEFAULTS,
        ffufWordlistPath: "wordlists/common.txt",
      }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({
        ...RUNNER_SETTINGS_DEFAULTS,
        ffufWordlistPath: "/lists/../etc/passwd",
      }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({
        ...RUNNER_SETTINGS_DEFAULTS,
        ffufBinaryPath: "/usr/bin/ffuf\0",
      }).success,
    ).toBe(false);
  });

  it("rejects out-of-range ints", () => {
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufRate: 0 }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufRate: 10_001 }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufThreads: 0 }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufThreads: 201 }).success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufTimeoutSeconds: 0 })
        .success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufTimeoutSeconds: 121 })
        .success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufMaxTimeSeconds: 4 })
        .success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufMaxTimeSeconds: 1801 })
        .success,
    ).toBe(false);
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufRate: 12.5 }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict, no passthrough)", () => {
    expect(
      RunnerSettingsSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, ffufBinary: "/usr/bin/ffuf" })
        .success,
    ).toBe(false);
    expect(
      GetSettingsResponseSchema.safeParse({ ...RUNNER_SETTINGS_DEFAULTS, scope: "runner" })
        .success,
    ).toBe(false);
  });
});

describe("UpdateSettingsRequestSchema", () => {
  it("accepts a partial update", () => {
    expect(UpdateSettingsRequestSchema.safeParse({ ffufRate: 50 }).success).toBe(true);
    expect(UpdateSettingsRequestSchema.safeParse({}).success).toBe(true);
    expect(
      UpdateSettingsRequestSchema.safeParse({
        ffufWordlistPath: "/usr/share/wordlists/common.txt",
        ffufThreads: 20,
      }).success,
    ).toBe(true);
  });

  it("rejects unknown keys and invalid values", () => {
    expect(
      UpdateSettingsRequestSchema.safeParse({ ffufRate: 50, general: {} }).success,
    ).toBe(false);
    expect(
      UpdateSettingsRequestSchema.safeParse({ ffufWordlistPath: "/lists/../etc/passwd" })
        .success,
    ).toBe(false);
    expect(UpdateSettingsRequestSchema.safeParse({ ffufRate: 0 }).success).toBe(false);
    expect(
      UpdateSettingsRequestSchema.safeParse({ ffufTimeoutSeconds: 10_000 }).success,
    ).toBe(false);
  });
});
