import { z } from "zod";

/**
 * Slice 1 settings contract: RUNNER scope only.
 * Persists validated runner defaults (ffuf binary path, default wordlist,
 * rate/threads/timeout/duration). Other scopes (general, appearance,
 * advisor, evidence, diagnostics) stay out of scope until later slices.
 * Strict Zod, no passthrough.
 */

export const SETTING_SCOPE_RUNNER = "runner" as const;

export const SettingScopeSchema = z.enum([SETTING_SCOPE_RUNNER]);

export type SettingScope = z.infer<typeof SettingScopeSchema>;

export const FFUF_BINARY_PATH_DEFAULT = "/usr/bin/ffuf" as const;
export const FFUF_WORDLIST_PATH_DEFAULT = "" as const;
export const FFUF_RATE_DEFAULT = 100 as const;
export const FFUF_THREADS_DEFAULT = 40 as const;
export const FFUF_TIMEOUT_SECONDS_DEFAULT = 10 as const;
export const FFUF_MAX_TIME_SECONDS_DEFAULT = 120 as const;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") && !value.includes("\0");
}

function hasPathTraversal(value: string): boolean {
  return value.split("/").includes("..");
}

const FfufBinaryPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isAbsolutePath, { message: "path must be absolute" })
  .refine((value) => !hasPathTraversal(value), { message: "path traversal rejected" });

// Empty means unset: the operator has not chosen a default wordlist yet.
const FfufWordlistPathSchema = z
  .string()
  .max(1024)
  .refine((value) => value === "" || isAbsolutePath(value), {
    message: "path must be absolute or empty",
  })
  .refine((value) => value === "" || !hasPathTraversal(value), {
    message: "path traversal rejected",
  });

export const RunnerSettingsSchema = z.strictObject({
  ffufBinaryPath: FfufBinaryPathSchema,
  ffufWordlistPath: FfufWordlistPathSchema,
  // Same ranges as the ffuf contract so persisted defaults stay launchable.
  ffufRate: z.number().int().min(1).max(10_000),
  ffufThreads: z.number().int().min(1).max(200),
  ffufTimeoutSeconds: z.number().int().min(1).max(120),
  ffufMaxTimeSeconds: z.number().int().min(5).max(1800),
});

export type RunnerSettings = z.infer<typeof RunnerSettingsSchema>;

export const RUNNER_SETTINGS_DEFAULTS: RunnerSettings = {
  ffufBinaryPath: FFUF_BINARY_PATH_DEFAULT,
  ffufWordlistPath: FFUF_WORDLIST_PATH_DEFAULT,
  ffufRate: FFUF_RATE_DEFAULT,
  ffufThreads: FFUF_THREADS_DEFAULT,
  ffufTimeoutSeconds: FFUF_TIMEOUT_SECONDS_DEFAULT,
  ffufMaxTimeSeconds: FFUF_MAX_TIME_SECONDS_DEFAULT,
};

export const GetSettingsResponseSchema = RunnerSettingsSchema;

export type GetSettingsResponse = z.infer<typeof GetSettingsResponseSchema>;

// Partial update: every field optional, unknown keys rejected.
export const UpdateSettingsRequestSchema = z.strictObject({
  ffufBinaryPath: FfufBinaryPathSchema.optional(),
  ffufWordlistPath: FfufWordlistPathSchema.optional(),
  ffufRate: RunnerSettingsSchema.shape.ffufRate.optional(),
  ffufThreads: RunnerSettingsSchema.shape.ffufThreads.optional(),
  ffufTimeoutSeconds: RunnerSettingsSchema.shape.ffufTimeoutSeconds.optional(),
  ffufMaxTimeSeconds: RunnerSettingsSchema.shape.ffufMaxTimeSeconds.optional(),
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
