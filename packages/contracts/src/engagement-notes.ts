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
});

export const UpdateEngagementNotesRequestSchema = z.strictObject({
  markdown: EngagementNotesMarkdownSchema,
});

export const EngagementNotesResponseSchema = EngagementNotesSchema;

export type EngagementNotes = z.infer<typeof EngagementNotesSchema>;
export type UpdateEngagementNotesRequest = z.infer<
  typeof UpdateEngagementNotesRequestSchema
>;
