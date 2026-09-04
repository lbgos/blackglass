import { z } from "zod";

/**
 * Settings contracts: RUNNER and ADVISOR scopes.
 * Each scope persists validated operator defaults. Other scopes (general,
 * appearance, evidence, diagnostics) stay out of scope until later slices.
 * Strict Zod, no passthrough.
 */

export const SETTING_SCOPE_RUNNER = "runner" as const;
export const SETTING_SCOPE_ADVISOR = "advisor" as const;

export const SettingScopeSchema = z.enum([
  SETTING_SCOPE_RUNNER,
  SETTING_SCOPE_ADVISOR,
]);

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

// Advisor scope: connection and budget defaults for the M8 local advisor.
// Empty endpointBaseUrl/modelId means unconfigured. API keys are never
// stored: apiKeyEnvVar names the environment variable resolved at request
// time (D6). A public endpoint URL without publicEndpointOptIn is accepted
// at storage; enforcement happens in a later runtime slice.
export const ADVISOR_ENDPOINT_BASE_URL_DEFAULT = "" as const;
export const ADVISOR_MODEL_ID_DEFAULT = "" as const;
export const ADVISOR_API_KEY_ENV_VAR_DEFAULT = "" as const;
export const ADVISOR_REQUEST_BUDGET_DEFAULT = 10 as const;
export const ADVISOR_RAW_RESPONSE_VISIBILITY_DEFAULT = true as const;
export const ADVISOR_PUBLIC_ENDPOINT_OPT_IN_DEFAULT = false as const;

const ADVISOR_ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

// Key material must never reach stored settings: any string value carrying
// a secret prefix is rejected before persistence.
const KEY_MATERIAL_PATTERN = /sk-|bearer /i;

function hasKeyMaterial(value: string): boolean {
  return KEY_MATERIAL_PATTERN.test(value);
}

function isHttpUrl(value: string): boolean {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Empty means unset: the operator has not configured an advisor endpoint yet.
const AdvisorEndpointBaseUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => value === "" || isHttpUrl(value), {
    message: "endpoint must be an http(s) URL or empty",
  })
  .refine((value) => !hasKeyMaterial(value), {
    message: "key material rejected",
  });

// Empty means unset: the operator has not chosen a model yet.
const AdvisorModelIdSchema = z
  .string()
  .max(128)
  .refine((value) => !hasKeyMaterial(value), {
    message: "key material rejected",
  });

const AdvisorApiKeyEnvVarSchema = z
  .string()
  .max(128)
  .refine(
    (value) => value === "" || ADVISOR_ENV_VAR_NAME_PATTERN.test(value),
    { message: "env var must match [A-Z_][A-Z0-9_]* or be empty" },
  )
  .refine((value) => !hasKeyMaterial(value), {
    message: "key material rejected",
  });

export const AdvisorSettingsSchema = z.strictObject({
  endpointBaseUrl: AdvisorEndpointBaseUrlSchema,
  modelId: AdvisorModelIdSchema,
  apiKeyEnvVar: AdvisorApiKeyEnvVarSchema,
  requestBudget: z.number().int().min(1).max(100),
  rawResponseVisibility: z.boolean(),
  publicEndpointOptIn: z.boolean(),
});

export type AdvisorSettings = z.infer<typeof AdvisorSettingsSchema>;

export const ADVISOR_SETTINGS_DEFAULTS: AdvisorSettings = {
  endpointBaseUrl: ADVISOR_ENDPOINT_BASE_URL_DEFAULT,
  modelId: ADVISOR_MODEL_ID_DEFAULT,
  apiKeyEnvVar: ADVISOR_API_KEY_ENV_VAR_DEFAULT,
  requestBudget: ADVISOR_REQUEST_BUDGET_DEFAULT,
  rawResponseVisibility: ADVISOR_RAW_RESPONSE_VISIBILITY_DEFAULT,
  publicEndpointOptIn: ADVISOR_PUBLIC_ENDPOINT_OPT_IN_DEFAULT,
};

export const GetAdvisorSettingsResponseSchema = AdvisorSettingsSchema;

export type GetAdvisorSettingsResponse = z.infer<
  typeof GetAdvisorSettingsResponseSchema
>;

// Partial update: every field optional, unknown keys rejected.
export const UpdateAdvisorSettingsRequestSchema = z.strictObject({
  endpointBaseUrl: AdvisorEndpointBaseUrlSchema.optional(),
  modelId: AdvisorModelIdSchema.optional(),
  apiKeyEnvVar: AdvisorApiKeyEnvVarSchema.optional(),
  requestBudget: AdvisorSettingsSchema.shape.requestBudget.optional(),
  rawResponseVisibility:
    AdvisorSettingsSchema.shape.rawResponseVisibility.optional(),
  publicEndpointOptIn:
    AdvisorSettingsSchema.shape.publicEndpointOptIn.optional(),
});

export type UpdateAdvisorSettingsRequest = z.infer<
  typeof UpdateAdvisorSettingsRequestSchema
>;
