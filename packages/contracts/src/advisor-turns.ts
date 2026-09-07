import { z } from "zod";

import {
  ADVISOR_EXPLANATION_PROFILE,
  AdvisorExplanationSchema,
  AdvisorPartitionedCitationSchema,
  AdvisorQuestionSchema,
  CreateAdvisorExplanationRequestSchema,
} from "./advisor-chat.js";
import { EngagementSchema } from "./engagement.js";

/**
 * Advisor turn route contracts (C1). POST bodies reuse the P1 request
 * schema; responses mirror P3a storage literals with status/output
 * coherence enforced in Zod. No storage digest, idempotency key,
 * supplied evidence, settings, or model internals are reflected.
 */

export const ADVISOR_TURN_LIST_DEFAULT_LIMIT = 50 as const;
export const ADVISOR_TURN_LIST_MAX_LIMIT = 50 as const;
export const ADVISOR_TURN_CURSOR_MAX_LENGTH = 512 as const;

export const AdvisorTurnStatusSchema = z.enum([
  "pending",
  "succeeded",
  "parse_error",
  "provider_error",
  "cancelled",
  "expired",
]);

export type AdvisorTurnStatus = z.infer<typeof AdvisorTurnStatusSchema>;

export const AdvisorTurnFailureCodeSchema = z.enum([
  "provider_timeout",
  "provider_unreachable",
  "provider_response_too_large",
  "provider_redirect_rejected",
  "provider_parse_error",
  "context_too_large",
]);

export type AdvisorTurnFailureCode = z.infer<typeof AdvisorTurnFailureCodeSchema>;

export const AdvisorTurnIdParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
});

export const CreateAdvisorTurnRequestSchema = CreateAdvisorExplanationRequestSchema;

export type CreateAdvisorTurnRequest = z.infer<typeof CreateAdvisorTurnRequestSchema>;

const AdvisorTurnModelIdSchema = z.string().min(1).max(128);

const advisorTurnBaseFields = {
  id: EngagementSchema.shape.id,
  engagementId: EngagementSchema.shape.id,
  question: AdvisorQuestionSchema,
  modelId: AdvisorTurnModelIdSchema,
  redactions: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

const emptyOutputs = {
  answer: z.literal(""),
  uncertainty: z.literal(""),
  citations: z.array(AdvisorPartitionedCitationSchema).length(0),
  abstained: z.null(),
};

const AdvisorTurnPendingSchema = z.strictObject({
  ...advisorTurnBaseFields,
  status: z.literal("pending"),
  ...emptyOutputs,
  errorCode: z.null(),
});

const AdvisorTurnSucceededSchema = z
  .strictObject({
    ...advisorTurnBaseFields,
    status: z.literal("succeeded"),
    answer: z.string(),
    uncertainty: z.string(),
    citations: z.array(AdvisorPartitionedCitationSchema),
    abstained: z.boolean(),
    errorCode: z.null(),
  })
  .superRefine((turn, context) => {
    // Reconstruct the P1 explanation from citation raw strings so byte,
    // uniqueness, and abstention invariants apply without restating them.
    const explanation = AdvisorExplanationSchema.safeParse({
      profile: ADVISOR_EXPLANATION_PROFILE,
      answer: turn.answer,
      citations: turn.citations.map((citation) => citation.raw),
      abstained: turn.abstained,
      uncertainty: turn.uncertainty,
    });
    if (!explanation.success) {
      context.addIssue({
        code: "custom",
        message: "succeeded output must satisfy the explanation contract",
      });
    }
  });

const AdvisorTurnFailedSchema = z.strictObject({
  ...advisorTurnBaseFields,
  status: z.enum(["parse_error", "provider_error"]),
  ...emptyOutputs,
  errorCode: AdvisorTurnFailureCodeSchema,
});

const AdvisorTurnCancelledSchema = z.strictObject({
  ...advisorTurnBaseFields,
  status: z.enum(["cancelled", "expired"]),
  ...emptyOutputs,
  errorCode: z.null(),
});

export const AdvisorTurnSchema = z.discriminatedUnion("status", [
  AdvisorTurnPendingSchema,
  AdvisorTurnSucceededSchema,
  AdvisorTurnFailedSchema,
  AdvisorTurnCancelledSchema,
]);

export type AdvisorTurn = z.infer<typeof AdvisorTurnSchema>;

export const AdvisorTurnListResponseSchema = z.strictObject({
  turns: z.array(AdvisorTurnSchema).max(ADVISOR_TURN_LIST_MAX_LIMIT),
  nextCursor: z
    .strictObject({ createdAt: z.iso.datetime(), id: EngagementSchema.shape.id })
    .nullable(),
});

export type AdvisorTurnListResponse = z.infer<typeof AdvisorTurnListResponseSchema>;

export interface ParsedAdvisorTurnListQuery {
  readonly limit: number;
  readonly before?: { readonly createdAt: string; readonly id: string };
}

// Strict HTTP scalar parsing for the list endpoint. Only limit,
// beforeCreatedAt, and beforeId are known keys. Limit is a decimal
// integer string 1 through 50 defaulting to 50; cursor fields must
// appear together with a datetime and an identifier. Empty,
// fractional, repeated (array), oversized, or unknown params fail.
const advisorTurnCursorTimestamp = z.iso.datetime();

export function parseAdvisorTurnListQuery(
  query: unknown,
): { ok: true; value: ParsedAdvisorTurnListQuery } | { ok: false } {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return { ok: false };
  }
  const record = query as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "limit" && key !== "beforeCreatedAt" && key !== "beforeId") {
      return { ok: false };
    }
  }
  let limit: number = ADVISOR_TURN_LIST_DEFAULT_LIMIT;
  if ("limit" in record) {
    const raw = record["limit"];
    if (typeof raw !== "string") return { ok: false };
    if (raw.length === 0 || raw.length > 15) return { ok: false };
    if (!/^[0-9]+$/.test(raw)) return { ok: false };
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) return { ok: false };
    if (parsed < 1 || parsed > ADVISOR_TURN_LIST_MAX_LIMIT) return { ok: false };
    limit = parsed;
  }
  const hasCreatedAt = "beforeCreatedAt" in record;
  const hasId = "beforeId" in record;
  if (!hasCreatedAt && !hasId) return { ok: true, value: { limit } };
  if (!hasCreatedAt || !hasId) return { ok: false };
  const createdAt = record["beforeCreatedAt"];
  const id = record["beforeId"];
  if (typeof createdAt !== "string" || typeof id !== "string") return { ok: false };
  if (createdAt.length > ADVISOR_TURN_CURSOR_MAX_LENGTH || id.length > 255) {
    return { ok: false };
  }
  if (!advisorTurnCursorTimestamp.safeParse(createdAt).success) return { ok: false };
  if (id.length < 1) return { ok: false };
  return { ok: true, value: { limit, before: { createdAt, id } } };
}

const AdvisorTurnErrorCodeSchema = z.enum([
  "invalid_request",
  "engagement_not_found",
  "engagement_archived",
  "idempotency_conflict",
  "turn_in_progress",
  "turn_not_found",
  "unknown_artifact",
  "unknown_finding",
  "missing_artifact",
  "corrupt_artifact",
  "context_too_large",
  "advisor_unconfigured",
  "missing_key_env",
  "key_unset",
  "public_not_opted_in",
  "storage_busy",
  "invalid_persisted_data",
]);

export const AdvisorTurnErrorSchema = z.strictObject({
  code: AdvisorTurnErrorCodeSchema,
});

export type AdvisorTurnError = z.infer<typeof AdvisorTurnErrorSchema>;
