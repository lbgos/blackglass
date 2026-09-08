import type { ReportBundle } from "@blackglass/contracts";
import { redactAdvisorText, stripAdvisorUrlUserinfo } from "@blackglass/domain";

// Derived sharing copy of a stored report bundle. Only operator-authored free
// text is transformed (engagement description/authorization context, finding
// title/body, notes); every id, digest, timestamp, count, and structured
// discovery row passes through untouched so the masked copy keeps its
// provenance. The stored bundle and query cache are never mutated: callers
// render, copy, and download from the returned copy. Masking is the existing
// heuristic advisor redactor, so it cannot guarantee every secret is removed.
export interface MaskedReport {
  readonly bundle: ReportBundle;
  readonly redactions: number;
}

function maskOperatorText(value: string, seen: { redactions: number }): string {
  const result = redactAdvisorText(stripAdvisorUrlUserinfo(value));
  seen.redactions += result.redactions;
  return result.text;
}

export function maskReportBundle(bundle: ReportBundle): MaskedReport {
  const seen = { redactions: 0 };
  return {
    bundle: {
      ...bundle,
      engagement: {
        ...bundle.engagement,
        description:
          bundle.engagement.description === null
            ? null
            : maskOperatorText(bundle.engagement.description, seen),
        authorizationContext:
          bundle.engagement.authorizationContext === null
            ? null
            : maskOperatorText(bundle.engagement.authorizationContext, seen),
      },
      findings: bundle.findings.map((finding) => ({
        ...finding,
        title: maskOperatorText(finding.title, seen),
        body: maskOperatorText(finding.body, seen),
      })),
      notesMarkdown: maskOperatorText(bundle.notesMarkdown, seen),
    },
    redactions: seen.redactions,
  };
}
