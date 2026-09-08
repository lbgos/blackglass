import type { ReportBundle } from "@blackglass/contracts";
import { redactAdvisorText, stripAdvisorUrlUserinfo } from "@blackglass/domain";

// Derived sharing copy of a stored report bundle. Only operator-authored free
// text is transformed (engagement name/description/authorization context,
// finding title/body, notes); every id, digest, timestamp, count, and
// structured discovery row passes through untouched so the masked copy keeps
// its provenance. The stored bundle and query cache are never mutated:
// callers render, copy, and download from the returned copy. Masking is the
// existing heuristic advisor redactor, so it cannot guarantee every secret is
// removed. maskedFields counts changed text fields, not redactor hits, so a
// URL userinfo strip with zero secret hits still counts. The derived copy is
// display/export only and is never truncated back into contract bounds: a
// replacement can grow a bounded title or name past its schema limit, which
// is reported, not silently cut.
export interface MaskedReport {
  readonly bundle: ReportBundle;
  readonly maskedFields: number;
}

function maskOperatorText(value: string, seen: { maskedFields: number }): string {
  const masked = redactAdvisorText(stripAdvisorUrlUserinfo(value)).text;
  if (masked !== value) seen.maskedFields += 1;
  return masked;
}

export function maskReportBundle(bundle: ReportBundle): MaskedReport {
  const seen = { maskedFields: 0 };
  return {
    bundle: {
      ...bundle,
      engagement: {
        ...bundle.engagement,
        name: maskOperatorText(bundle.engagement.name, seen),
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
    maskedFields: seen.maskedFields,
  };
}
