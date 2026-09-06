/**
 * Pure redaction helpers for the read-only evidence explanation slice.
 * Every string assembled for a model prompt passes through redactAdvisorText
 * before use. Replacement counts feed audit metadata; matched secret values
 * are never logged, persisted, or echoed elsewhere.
 */

export const ADVISOR_REDACTION_TOKEN = "[redacted]" as const;
export const ADVISOR_CONTEXT_MAX_BYTES = 16_384 as const;

const FLAG_PATTERN = /(?:flag|ctf)\{[^}\r\n]{1,256}\}/gi;
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{0,4096}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const PRIVATE_KEY_BEGIN_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g;
const SECRET_KEY_PATTERN = /sk-[A-Za-z0-9\-_]{8,}/g;
const BEARER_PATTERN = /bearer\s+[A-Za-z0-9\-_.~+/=]{8,}/gi;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{1,256}/gi;
const URL_USERINFO_PATTERN = /^(https?:\/\/)[^/\s?#]+@(.+)$/;

export interface AdvisorRedaction {
  readonly text: string;
  readonly redactions: number;
}

function countMatches(pattern: RegExp, value: string): number {
  pattern.lastIndex = 0;
  const matches = value.match(pattern);
  return matches === null ? 0 : matches.length;
}

function replaceCounted(pattern: RegExp, value: string, replacement: string): AdvisorRedaction {
  const redactions = countMatches(pattern, value);
  pattern.lastIndex = 0;
  return { text: value.replace(pattern, replacement), redactions };
}

// Redact secret-shaped values. Order matters: full key blocks first so a lone
// BEGIN line never survives when its END marker is missing.
export function redactAdvisorText(value: string): AdvisorRedaction {
  let text = value;
  let redactions = 0;
  const apply = (result: AdvisorRedaction): void => {
    text = result.text;
    redactions += result.redactions;
  };
  apply(replaceCounted(PRIVATE_KEY_BLOCK_PATTERN, text, ADVISOR_REDACTION_TOKEN));
  apply(replaceCounted(PRIVATE_KEY_BEGIN_PATTERN, text, ADVISOR_REDACTION_TOKEN));
  apply(replaceCounted(FLAG_PATTERN, text, ADVISOR_REDACTION_TOKEN));
  apply(replaceCounted(SECRET_KEY_PATTERN, text, ADVISOR_REDACTION_TOKEN));
  apply(replaceCounted(BEARER_PATTERN, text, ADVISOR_REDACTION_TOKEN));
  CREDENTIAL_ASSIGNMENT_PATTERN.lastIndex = 0;
  const assignments = text.match(CREDENTIAL_ASSIGNMENT_PATTERN);
  redactions += assignments === null ? 0 : assignments.length;
  CREDENTIAL_ASSIGNMENT_PATTERN.lastIndex = 0;
  text = text.replace(
    CREDENTIAL_ASSIGNMENT_PATTERN,
    (_match: string, name: string) => `${name}: ${ADVISOR_REDACTION_TOKEN}`,
  );
  return { text, redactions };
}

// Strip userinfo (credentials) from an http(s) URL. Non-URL text and URLs
// without userinfo pass through unchanged.
export function stripAdvisorUrlUserinfo(value: string): string {
  const match = URL_USERINFO_PATTERN.exec(value);
  if (match === null) return value;
  const scheme = match[1] ?? "";
  const rest = match[2] ?? "";
  return `${scheme}${rest}`;
}

// Quote one evidence block as untrusted data. Model instructions live
// elsewhere; anything inside these delimiters is data, even when it reads
// like an instruction.
export function quoteAdvisorEvidenceBlock(kind: string, id: string, text: string): string {
  return `<evidence kind="${kind}" id="${id}">\n${text}\n</evidence>`;
}

export function advisorUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isAdvisorContextWithinBudget(value: string, maxBytes: number): boolean {
  return advisorUtf8ByteLength(value) <= maxBytes;
}
