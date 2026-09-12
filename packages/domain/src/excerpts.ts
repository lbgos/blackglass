import { redactAdvisorText } from "./advisor-redact.js";
import type { Excerpt } from "@stonehush/contracts";

/**
 * Pure excerpt helpers for the STONE-3 fast-capture slice. Byte ranges are
 * validated against the stored artifact size so invented offsets can never
 * address bytes outside the preserved source. Secret masking reuses the
 * shared advisor redactor: excerpt content, search snippets, and finding
 * prefill text all pass through it before persistence or display.
 */

export const EXCERPT_RANGE_MAX_BYTES = 8_192 as const;
export const EXCERPT_SNIPPET_RADIUS_CHARS = 160 as const;

export function validateExcerptRange(
  totalBytes: number,
  byteOffset: number,
  byteLength: number,
): { ok: true } | { ok: false; code: "range_rejected" } {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 0 ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > EXCERPT_RANGE_MAX_BYTES
  ) {
    return { ok: false, code: "range_rejected" };
  }
  if (byteOffset + byteLength > totalBytes) {
    return { ok: false, code: "range_rejected" };
  }
  return { ok: true };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// Maps a char range inside displayed text to UTF-8 byte offsets for the
// server range request. Out-of-order or empty selections are rejected so a
// misclick can never produce a zero-length excerpt.
export function selectionBytesFromText(
  fullText: string,
  charStart: number,
  charEnd: number,
):
  | { ok: true; byteOffset: number; byteLength: number }
  | { ok: false; code: "range_rejected" } {
  const points = Array.from(fullText).length;
  if (
    !Number.isSafeInteger(charStart) ||
    !Number.isSafeInteger(charEnd) ||
    charStart < 0 ||
    charEnd <= charStart ||
    charEnd > points
  ) {
    return { ok: false, code: "range_rejected" };
  }
  const chars = Array.from(fullText);
  const byteOffset = utf8ByteLength(chars.slice(0, charStart).join(""));
  const byteLength = utf8ByteLength(chars.slice(charStart, charEnd).join(""));
  if (byteLength < 1 || byteLength > EXCERPT_RANGE_MAX_BYTES) {
    return { ok: false, code: "range_rejected" };
  }
  return { ok: true, byteOffset, byteLength };
}

export interface MaskedExcerptText {
  readonly text: string;
  readonly redactions: number;
}

// Masked before persistence or display. The redactor is heuristic
// defense-in-depth, documented in advisor-redact.ts; structural bounds are
// the primary boundary.
export function maskExcerptText(value: string): MaskedExcerptText {
  const result = redactAdvisorText(value);
  return { text: result.text, redactions: result.redactions };
}

export interface TextMatch {
  readonly charOffset: number;
  readonly charLength: number;
}

// Case-insensitive non-overlapping substring search over decoded text.
// Empty queries match nothing; the route rejects them as invalid_request.
export function findTextMatches(
  haystack: string,
  query: string,
  maxMatches: number,
): TextMatch[] {
  if (query.length === 0 || maxMatches < 1) return [];
  const loweredHaystack = haystack.toLowerCase();
  const loweredQuery = query.toLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  while (matches.length < maxMatches) {
    const index = loweredHaystack.indexOf(loweredQuery, from);
    if (index < 0) break;
    matches.push({
      charOffset: Array.from(haystack.slice(0, index)).length,
      charLength: Array.from(query).length,
    });
    from = index + query.length;
    if (query.length === 0) break;
  }
  return matches;
}

export interface TextSnippet {
  readonly snippet: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
}

// Bounded window centered on a match so long output is excerptable without
// rendering the whole file. Boundaries fall on code points, never mid-char.
export function windowSnippetFromChars(
  text: string,
  charOffset: number,
  charLength: number,
  radius: number = EXCERPT_SNIPPET_RADIUS_CHARS,
): TextSnippet {
  const points = Array.from(text);
  const start = Math.max(0, charOffset - radius);
  const end = Math.min(points.length, charOffset + charLength + radius);
  const window = points.slice(start, end).join("");
  const prefix = start > 0 ? "..." : "";
  const suffix = end < points.length ? "..." : "";
  return {
    snippet: `${prefix}${window}${suffix}`,
    truncatedBefore: start > 0,
    truncatedAfter: end < points.length,
  };
}

// Byte offset of a char offset, for reporting server-style match positions
// from decoded scan text.
export function byteOffsetOfCharOffset(text: string, charOffset: number): number {
  return utf8ByteLength(Array.from(text).slice(0, Math.max(0, charOffset)).join(""));
}

// Attachment filename derived from what the image proves. Lowercase slug;
// anything unusable falls back to the neutral default so uploads never fail
// on naming alone.
export function deriveAttachmentName(proof: string, fallback: string): string {
  const slug = proof
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  if (slug.length > 0) return slug;
  const fallbackSlug = fallback
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return fallbackSlug.length > 0 ? fallbackSlug : "evidence-image";
}

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Display-space crop metadata only; the original bytes are always kept and
// derivation records the parent id, so a crop can never destroy evidence.
export function isCropRectValid(rect: CropRect): boolean {
  for (const value of [rect.x, rect.y, rect.width, rect.height]) {
    if (!Number.isSafeInteger(value) || value < 0) return false;
  }
  if (rect.width < 1 || rect.height < 1) return false;
  if (rect.width > 100_000 || rect.height > 100_000) return false;
  return true;
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function shortDigest(digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return hex.slice(0, 12);
}

export function formatExcerptSourceLabel(excerpt: Pick<
  Excerpt,
  "runId" | "stream" | "byteOffset" | "byteLength" | "artifactId" | "artifactDigest"
>): string {
  return `run ${shortId(excerpt.runId)} ${excerpt.stream} @${excerpt.byteOffset}+${excerpt.byteLength} (${excerpt.artifactId}, ${shortDigest(excerpt.artifactDigest)})`;
}

// Finding prefill shared by the web layer. Target context is the operator
// annotation when present and labelled as such; the stable server-verified
// reference (run, stream, offsets, artifact id, digest) is always included
// so the finding never depends on retyping or an artifact-ID field.
export function buildFindingPrefillBody(
  excerpt: Pick<
    Excerpt,
    "runId" | "stream" | "byteOffset" | "byteLength" | "artifactId" | "artifactDigest" | "content" | "targetNote"
  >,
): string {
  const lines = [
    `Source: ${formatExcerptSourceLabel(excerpt)}`,
    excerpt.targetNote === null
      ? "Target: operator note unavailable"
      : `Target (operator note): ${excerpt.targetNote}`,
    "Excerpt:",
    excerpt.content,
  ];
  return lines.join("\n");
}
