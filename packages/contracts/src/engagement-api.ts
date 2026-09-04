import { z } from "zod";

import {
  AppendScopeRevisionInputSchema,
  CreateEngagementInputSchema,
  EngagementDeadlineSchema,
  EngagementSchema,
  EngagementWithActiveScopeSchema,
  ScopeRevisionSchema,
} from "./engagement.js";

export const EngagementIdParamsSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
});

export const EngagementListResponseSchema = z.array(EngagementSchema);
export const EngagementDetailResponseSchema = EngagementWithActiveScopeSchema;
export const ScopeRevisionListResponseSchema = z.array(ScopeRevisionSchema);

export const CreateEngagementRequestSchema = CreateEngagementInputSchema;
export const EngagementMutationQuerySchema = z.strictObject({});
export const EngagementRevisionRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
});
export const UpdateAutoContinueWarningsRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  autoContinueWarnings: z.boolean(),
});
// Explicit null clears the deadline; the key itself is required.
export const UpdateEngagementDeadlineRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  deadlineAt: EngagementDeadlineSchema.nullable(),
});
export const AppendScopeRevisionRequestSchema = AppendScopeRevisionInputSchema.omit({
  engagementId: true,
});

export const EngagementMutationResponseSchema = EngagementSchema;
export const ScopeRevisionMutationResponseSchema = ScopeRevisionSchema;

export const EngagementMutationErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("engagement_archived") }),
  z.strictObject({ code: z.literal("invalid_engagement_transition") }),
  z.strictObject({ code: z.literal("idempotency_conflict") }),
  z.strictObject({
    code: z.literal("revision_conflict"),
    resourceType: z.literal("engagement"),
    resourceId: EngagementSchema.shape.id,
    currentRevision: z.number().int().positive(),
  }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export const EngagementQueryErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export type EngagementIdParams = z.infer<typeof EngagementIdParamsSchema>;
export type EngagementQueryError = z.infer<typeof EngagementQueryErrorSchema>;
export type EngagementMutationError = z.infer<
  typeof EngagementMutationErrorSchema
>;
