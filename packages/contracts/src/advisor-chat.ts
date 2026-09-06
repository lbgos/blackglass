import { z } from "zod";

import { EngagementSchema } from "./engagement.js";
import { OpaqueArtifactIdSchema } from "./evidence.js";

/**
 * Read-only evidence explanation contracts (bounded A5 advisor P1).
 * A user-requested explanation of explicitly selected evidence excerpts and
 * findings. No provider transport, no tool calls, no action proposals, no
 * execution, no attack steps: the answer explains supplied evidence and its
 * uncertainty only. Strict Zod, no passthrough.
 */

export const ADVISOR_EXPLANATION_PROFILE = "advisor-explanation-v1" as const;

export const ADVISOR_QUESTION_MAX_BYTES = 2_000 as const;
export const ADVISOR_EXCERPT_IDS_MAX = 4 as const;
export const ADVISOR_FINDING_IDS_MAX = 8 as const;
export const ADVISOR_EVIDENCE_BLOCKS_MAX = 12 as const;
export const ADVISOR_EVIDENCE_TEXT_MAX_BYTES = 8_192 as const;
export const ADVISOR_CITATIONS_MAX = 32 as const;
export const ADVISOR_CITATION_ID_MAX_CHARS = 128 as const;
export const ADVISOR_ANSWER_MAX_BYTES = 8_000 as const;
export const ADVISOR_UNCERTAINTY_MAX_BYTES = 2_000 as const;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const AdvisorQuestionSchema = z
  .string()
  .refine((value) => value === value.trim(), {
    message: "must not have leading or trailing whitespace",
  })
  .refine(
    (value) => utf8ByteLength(value) >= 1 && utf8ByteLength(value) <= ADVISOR_QUESTION_MAX_BYTES,
    { message: "must contain between 1 and 2000 UTF-8 bytes" },
  );

const UniqueExcerptIdsSchema = z
  .array(OpaqueArtifactIdSchema)
  .min(1)
  .max(ADVISOR_EXCERPT_IDS_MAX)
  .superRefine((values, context) => {
    if (!hasUniqueValues(values)) {
      context.addIssue({ code: "custom", message: "duplicate excerpt artifact id" });
    }
  });

const UniqueFindingIdsSchema = z
  .array(EngagementSchema.shape.id)
  .max(ADVISOR_FINDING_IDS_MAX)
  .superRefine((values, context) => {
    if (!hasUniqueValues(values)) {
      context.addIssue({ code: "custom", message: "duplicate finding id" });
    }
  });

export const CreateAdvisorExplanationRequestSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
  question: AdvisorQuestionSchema,
  excerptArtifactIds: UniqueExcerptIdsSchema,
  findingIds: UniqueFindingIdsSchema.optional().default([]),
});

export type CreateAdvisorExplanationRequest = z.infer<
  typeof CreateAdvisorExplanationRequestSchema
>;

export const AdvisorEvidenceKindSchema = z.enum(["artifact", "finding", "service", "probe"]);

export type AdvisorEvidenceKind = z.infer<typeof AdvisorEvidenceKindSchema>;

// One evidence item supplied to the model for this turn. Engagement ownership
// of these ids is verified by the route slice before any model call; these
// contracts only validate shape and per-turn caps.
export const AdvisorSuppliedEvidenceIdSchema = z.strictObject({
  kind: AdvisorEvidenceKindSchema,
  id: z.string().min(1).max(ADVISOR_CITATION_ID_MAX_CHARS),
});

export type AdvisorSuppliedEvidenceId = z.infer<typeof AdvisorSuppliedEvidenceIdSchema>;

// One bounded evidence text block quoted as untrusted data in the prompt.
export const AdvisorEvidenceBlockSchema = z.strictObject({
  kind: AdvisorEvidenceKindSchema,
  id: z.string().min(1).max(ADVISOR_CITATION_ID_MAX_CHARS),
  text: z
    .string()
    .refine((value) => utf8ByteLength(value) <= ADVISOR_EVIDENCE_TEXT_MAX_BYTES, {
      message: "must contain at most 8192 UTF-8 bytes",
    }),
});

export type AdvisorEvidenceBlock = z.infer<typeof AdvisorEvidenceBlockSchema>;

export const AdvisorEvidenceBlockListSchema = z
  .array(AdvisorEvidenceBlockSchema)
  .max(ADVISOR_EVIDENCE_BLOCKS_MAX);

const UniqueCitationIdsSchema = z
  .array(z.string().min(1).max(ADVISOR_CITATION_ID_MAX_CHARS))
  .max(ADVISOR_CITATIONS_MAX)
  .superRefine((values, context) => {
    if (!hasUniqueValues(values)) {
      context.addIssue({ code: "custom", message: "duplicate citation" });
    }
  });

// Model output for a read-only explanation. Citations must name supplied
// evidence only; the partition helper marks anything else invalid and inert.
// A non-abstained answer must be non-blank; an abstention must state what is
// uncertain instead of answering.
export const AdvisorExplanationSchema = z
  .strictObject({
    profile: z.literal(ADVISOR_EXPLANATION_PROFILE),
    answer: z
      .string()
      .refine((value) => utf8ByteLength(value) <= ADVISOR_ANSWER_MAX_BYTES, {
        message: "must contain at most 8000 UTF-8 bytes",
      }),
    citations: UniqueCitationIdsSchema,
    abstained: z.boolean(),
    uncertainty: z
      .string()
      .refine((value) => utf8ByteLength(value) <= ADVISOR_UNCERTAINTY_MAX_BYTES, {
        message: "must contain at most 2000 UTF-8 bytes",
      }),
  })
  .superRefine((value, context) => {
    if (!value.abstained && value.answer.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "answer must be non-blank unless abstained",
        path: ["answer"],
      });
    }
    if (value.abstained && value.uncertainty.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "uncertainty must be non-blank when abstained",
        path: ["uncertainty"],
      });
    }
  });

export type AdvisorExplanation = z.infer<typeof AdvisorExplanationSchema>;

// Partitioned citation for UI rendering. Valid citations reference supplied
// evidence and may render as inert reference chips; invalid ones are unknown
// strings and must render as plain text, never as links or trust signals.
export const AdvisorCitationKindSchema = z.enum([
  "artifact",
  "finding",
  "service",
  "probe",
  "unknown",
]);

export const AdvisorPartitionedCitationSchema = z
  .strictObject({
    raw: z.string().min(1).max(ADVISOR_CITATION_ID_MAX_CHARS),
    valid: z.boolean(),
    kind: AdvisorCitationKindSchema,
  })
  .superRefine((value, context) => {
    const consistent =
      (value.valid && value.kind !== "unknown") ||
      (!value.valid && value.kind === "unknown");
    if (!consistent) {
      context.addIssue({
        code: "custom",
        message: "valid citations must name a known kind and invalid ones must be unknown",
        path: ["kind"],
      });
    }
  });

export type AdvisorPartitionedCitation = z.infer<typeof AdvisorPartitionedCitationSchema>;
