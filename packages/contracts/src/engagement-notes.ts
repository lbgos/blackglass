import { z } from "zod";

import { EngagementSchema } from "./engagement.js";

export const ENGAGEMENT_NOTES_MAX_BYTES = 65_536 as const;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const EngagementNotesMarkdownSchema = z
  .string()
  .refine((value) => utf8ByteLength(value) <= ENGAGEMENT_NOTES_MAX_BYTES, {
    message: "must contain at most 65536 UTF-8 bytes",
  });

export const EngagementNotesSchema = z.strictObject({
  engagementId: EngagementSchema.shape.id,
  markdown: EngagementNotesMarkdownSchema,
  updatedAt: z.iso.datetime(),
  revision: z.number().int().safe().nonnegative(),
});

export const UpdateEngagementNotesRequestSchema = z.strictObject({
  markdown: EngagementNotesMarkdownSchema,
  expectedRevision: z.number().int().safe().nonnegative(),
});

export const EngagementNotesResponseSchema = EngagementNotesSchema;

export const UpdateEngagementNotesErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("engagement_archived") }),
  z.strictObject({
    code: z.literal("revision_conflict"),
    resourceType: z.literal("engagement_notes"),
    resourceId: EngagementSchema.shape.id,
    currentRevision: z.number().int().safe().nonnegative(),
  }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export type EngagementNotes = z.infer<typeof EngagementNotesSchema>;
export type UpdateEngagementNotesRequest = z.infer<
  typeof UpdateEngagementNotesRequestSchema
>;
export type UpdateEngagementNotesError = z.infer<
  typeof UpdateEngagementNotesErrorSchema
>;
