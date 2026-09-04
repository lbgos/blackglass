import { z } from "zod";

import { SavedScopeRuleSchema } from "./saved-scope.js";

export const ENGAGEMENT_CONTRACT_VERSION = 1 as const;

const IdentifierSchema = z.uuid({ version: "v4" });
const UtcTimestampSchema = z.iso.datetime();

function hasCodePointLength(value: string, minimum: number, maximum: number): boolean {
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

const OptionalContextSchema = z
  .string()
  .refine((value) => hasCodePointLength(value, 0, 4_096), {
    message: "must contain at most 4096 Unicode code points",
  })
  .nullable();

export const EngagementKindSchema = z.enum(["ctf", "lab", "assessment"]);
export const EngagementStatusSchema = z.enum(["active", "archived"]);

// Optional engagement deadline. Null means no deadline. Input values must be
// strict UTC ISO-8601 timestamps no more than 10 years in the future; the
// empty string, malformed values, and far-future dates are rejected. Past
// deadlines are accepted so overdue engagements stay representable.
const MAX_DEADLINE_OFFSET_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export const EngagementDeadlineSchema = UtcTimestampSchema.refine(
  (value) => Date.parse(value) - Date.now() <= MAX_DEADLINE_OFFSET_MS,
  { message: "must be at most 10 years in the future" },
);

export const EngagementNameSchema = z
  .string()
  .refine((value) => value === value.trim(), {
    message: "must not have leading or trailing whitespace",
  })
  .refine((value) => hasCodePointLength(value, 1, 120), {
    message: "must contain between 1 and 120 Unicode code points",
  });

export const EngagementSchema = z.strictObject({
  contractVersion: z.literal(ENGAGEMENT_CONTRACT_VERSION),
  id: IdentifierSchema,
  revision: z.number().int().positive(),
  name: EngagementNameSchema,
  kind: EngagementKindSchema,
  status: EngagementStatusSchema,
  description: OptionalContextSchema,
  authorizationContext: OptionalContextSchema,
  autoContinueWarnings: z.boolean(),
  activeScopeRevisionId: IdentifierSchema.nullable(),
  deadlineAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const ScopeRevisionSchema = z.strictObject({
  contractVersion: z.literal(ENGAGEMENT_CONTRACT_VERSION),
  id: IdentifierSchema,
  engagementId: IdentifierSchema,
  version: z.number().int().positive(),
  rules: z.array(SavedScopeRuleSchema),
  createdAt: UtcTimestampSchema,
});

export const EngagementWithActiveScopeSchema = z
  .strictObject({
    engagement: EngagementSchema,
    activeScopeRevision: ScopeRevisionSchema.nullable(),
  })
  .superRefine((value, context) => {
    const active = value.activeScopeRevision;
    if (
      (active === null && value.engagement.activeScopeRevisionId !== null) ||
      (active !== null &&
        (value.engagement.activeScopeRevisionId !== active.id ||
          value.engagement.id !== active.engagementId))
    ) {
      context.addIssue({ code: "custom", message: "active scope mismatch" });
    }
  });

export const CreateEngagementInputSchema = z.strictObject({
  name: EngagementNameSchema,
  kind: EngagementKindSchema,
  description: OptionalContextSchema.optional().default(null),
  authorizationContext: OptionalContextSchema.optional().default(null),
  autoContinueWarnings: z.boolean(),
  // Absent means no deadline; kept default-free so the D2 canonical digest
  // stays stable for deadline-free creates.
  deadlineAt: EngagementDeadlineSchema.optional(),
});

export const AppendScopeRevisionInputSchema = z.strictObject({
  engagementId: IdentifierSchema,
  expectedRevision: z.number().int().positive(),
  rules: z.array(SavedScopeRuleSchema),
});

export type EngagementKind = z.infer<typeof EngagementKindSchema>;
export type EngagementStatus = z.infer<typeof EngagementStatusSchema>;
export type Engagement = z.infer<typeof EngagementSchema>;
export type ScopeRevision = z.infer<typeof ScopeRevisionSchema>;
export type EngagementWithActiveScope = z.infer<
  typeof EngagementWithActiveScopeSchema
>;
export type CreateEngagementInput = z.input<
  typeof CreateEngagementInputSchema
>;
export type AppendScopeRevisionInput = z.infer<
  typeof AppendScopeRevisionInputSchema
>;
