import { z } from "zod";

import { EngagementKindSchema, EngagementStatusSchema, EngagementSchema } from "./engagement.js";
import { EngagementNotesMarkdownSchema } from "./engagement-notes.js";
import {
  EvidenceArtifactKindSchema,
  EvidenceDigestSchema,
  OpaqueArtifactIdSchema,
  PublishedCompletenessSchema,
} from "./evidence.js";
import { FfufProjectedSchema } from "./ffuf.js";
import { FindingSchema } from "./findings.js";
import { HttpProbeProjectedSchema } from "./http-probe.js";
import { NmapProjectedServiceSchema } from "./nmap.js";

/**
 * Read-only engagement report bundle (v0.1 slice 1).
 * One endpoint plus a Report section with copy and download. No editor,
 * no PDF, no print HTML. Public contracts originate here; the API route
 * and the web Report section must not redefine these shapes.
 */

export const REPORT_CONTRACT_VERSION = 1 as const;
// Top rows per capped section; the API truncates deterministically and
// reports the full total alongside a truncated flag.
export const REPORT_MAX_ROWS = 1000 as const;

const UtcTimestampSchema = z.iso.datetime({ offset: true });

// Engagement meta carried into the report, deadline included. A fixed
// subset of the engagement record so report output stays stable when the
// engagement contract grows.
export const ReportEngagementMetaSchema = z.strictObject({
  id: EngagementSchema.shape.id,
  name: z.string().min(1).max(120),
  kind: EngagementKindSchema,
  status: EngagementStatusSchema,
  description: z.string().max(4096).nullable(),
  authorizationContext: z.string().max(4096).nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  revision: z.number().int().positive(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export type ReportEngagementMeta = z.infer<typeof ReportEngagementMetaSchema>;

function cappedSectionSchema<Row extends z.ZodTypeAny>(row: Row) {
  return z
    .strictObject({
      total: z.number().int().nonnegative(),
      truncated: z.boolean(),
      rows: z.array(row).max(REPORT_MAX_ROWS),
    })
    .superRefine((section, context) => {
      if (section.total < section.rows.length) {
        context.addIssue({
          code: "custom",
          message: "total must cover the returned rows",
          path: ["total"],
        });
      }
      if (section.truncated !== section.total > section.rows.length) {
        context.addIssue({
          code: "custom",
          message: "truncated must reflect total versus returned rows",
          path: ["truncated"],
        });
      }
    });
}

export const ReportServicesSectionSchema = cappedSectionSchema(NmapProjectedServiceSchema);
export const ReportProbesSectionSchema = cappedSectionSchema(HttpProbeProjectedSchema);
export const ReportFfufSectionSchema = cappedSectionSchema(FfufProjectedSchema);

// Evidence artifact digests referenced by the report. Digests only: content
// stays behind the artifact download route.
export const ReportEvidenceArtifactSchema = z.strictObject({
  artifactId: OpaqueArtifactIdSchema,
  digest: EvidenceDigestSchema,
  sizeBytes: z.number().int().safe().nonnegative(),
  kind: EvidenceArtifactKindSchema,
  completeness: PublishedCompletenessSchema,
  runId: z.string().min(1).max(255),
});

export type ReportEvidenceArtifact = z.infer<typeof ReportEvidenceArtifactSchema>;

export const ReportEvidenceSectionSchema = cappedSectionSchema(ReportEvidenceArtifactSchema);

export const ReportBundleSchema = z.strictObject({
  contractVersion: z.literal(REPORT_CONTRACT_VERSION),
  engagement: ReportEngagementMetaSchema,
  findings: z.array(FindingSchema),
  notesMarkdown: EngagementNotesMarkdownSchema,
  notesUpdatedAt: UtcTimestampSchema,
  services: ReportServicesSectionSchema,
  probes: ReportProbesSectionSchema,
  ffufResults: ReportFfufSectionSchema,
  evidenceArtifacts: ReportEvidenceSectionSchema,
  generatedAt: UtcTimestampSchema,
});

export type ReportBundle = z.infer<typeof ReportBundleSchema>;

export const ReportFormatQuerySchema = z.object({
  format: z.enum(["json", "markdown"]).optional().default("json"),
});

export type ReportFormatQuery = z.infer<typeof ReportFormatQuerySchema>;

export const ReportQueryErrorSchema = z.union([
  z.strictObject({ code: z.literal("invalid_request") }),
  z.strictObject({ code: z.literal("engagement_not_found") }),
  z.strictObject({ code: z.literal("invalid_persisted_data") }),
  z.strictObject({ code: z.literal("storage_busy") }),
]);

export type ReportQueryError = z.infer<typeof ReportQueryErrorSchema>;

// Deterministic top-rows cap shared by the API route and unit tests.
// Rows keep their input order; the caller sorts before capping.
export function capReportRows<Row>(rows: readonly Row[]): {
  total: number;
  truncated: boolean;
  rows: Row[];
} {
  const total = rows.length;
  const truncated = total > REPORT_MAX_ROWS;
  return {
    total,
    truncated,
    rows: truncated ? rows.slice(0, REPORT_MAX_ROWS) : [...rows],
  };
}

// Deterministic Markdown renderer: fixed section order, raw UTC ISO
// timestamps, no locale formatting, trailing newline. Operator and
// finding content is embedded verbatim.
export function engagementReportMarkdown(bundle: ReportBundle): string {
  const lines: string[] = [];
  const engagement = bundle.engagement;
  lines.push(`# Engagement report: ${engagement.name}`);
  lines.push("");
  lines.push(`- Engagement id: ${engagement.id}`);
  lines.push(`- Kind: ${engagement.kind}`);
  lines.push(`- Status: ${engagement.status}`);
  lines.push(`- Revision: ${engagement.revision}`);
  lines.push(`- Deadline: ${engagement.deadlineAt ?? "none"}`);
  lines.push(`- Created: ${engagement.createdAt}`);
  lines.push(`- Updated: ${engagement.updatedAt}`);
  lines.push(`- Generated: ${bundle.generatedAt}`);
  if (engagement.description !== null) {
    lines.push(`- Description: ${engagement.description}`);
  }
  if (engagement.authorizationContext !== null) {
    lines.push(`- Authorization: ${engagement.authorizationContext}`);
  }
  lines.push("");
  lines.push(`## Findings (${bundle.findings.length})`);
  lines.push("");
  if (bundle.findings.length === 0) {
    lines.push("_No findings recorded._");
    lines.push("");
  } else {
    for (const finding of bundle.findings) {
      lines.push(`### [${finding.severity}] ${finding.title} (${finding.status})`);
      lines.push("");
      lines.push(`- Finding id: ${finding.id}`);
      lines.push(`- Created: ${finding.createdAt}`);
      lines.push(`- Updated: ${finding.updatedAt}`);
      if (finding.evidenceArtifactIds.length > 0) {
        lines.push(`- Evidence: ${finding.evidenceArtifactIds.join(", ")}`);
      }
      lines.push("");
      lines.push(finding.body.length > 0 ? finding.body : "_No detail._");
      lines.push("");
    }
  }
  lines.push("## Notes");
  lines.push("");
  lines.push(bundle.notesMarkdown.length > 0 ? bundle.notesMarkdown : "_No notes._");
  lines.push("");
  lines.push(`## Services (${bundle.services.total})`);
  lines.push("");
  if (bundle.services.rows.length === 0) {
    lines.push("_No services observed._");
    lines.push("");
  } else {
    for (const service of bundle.services.rows) {
      const identity =
        service.product ?? service.serviceName ?? "unknown";
      lines.push(
        `- ${service.address}:${service.port}/${service.protocol} ${identity} (observed ${service.observedAt}, artifact ${service.artifactId})`,
      );
    }
    lines.push("");
    if (bundle.services.truncated) {
      lines.push(
        `_Truncated to the first ${bundle.services.rows.length} of ${bundle.services.total} services._`,
      );
      lines.push("");
    }
  }
  lines.push(`## HTTP probes (${bundle.probes.total})`);
  lines.push("");
  if (bundle.probes.rows.length === 0) {
    lines.push("_No HTTP probes recorded._");
    lines.push("");
  } else {
    for (const probe of bundle.probes.rows) {
      lines.push(
        `- ${probe.url} -> ${probe.finalUrl} ${probe.status ?? "no status"}${probe.title ? ` "${probe.title}"` : ""} (observed ${probe.observedAt}, artifact ${probe.artifactId})`,
      );
    }
    lines.push("");
    if (bundle.probes.truncated) {
      lines.push(
        `_Truncated to the first ${bundle.probes.rows.length} of ${bundle.probes.total} probes._`,
      );
      lines.push("");
    }
  }
  lines.push(`## ffuf results (${bundle.ffufResults.total})`);
  lines.push("");
  if (bundle.ffufResults.rows.length === 0) {
    lines.push("_No ffuf results recorded._");
    lines.push("");
  } else {
    for (const result of bundle.ffufResults.rows) {
      lines.push(
        `- ${result.url} ${result.status} (${result.fuzz}, observed ${result.observedAt}, artifact ${result.artifactId})`,
      );
    }
    lines.push("");
    if (bundle.ffufResults.truncated) {
      lines.push(
        `_Truncated to the first ${bundle.ffufResults.rows.length} of ${bundle.ffufResults.total} ffuf results._`,
      );
      lines.push("");
    }
  }
  lines.push(`## Evidence artifacts (${bundle.evidenceArtifacts.total})`);
  lines.push("");
  if (bundle.evidenceArtifacts.rows.length === 0) {
    lines.push("_No evidence artifacts published._");
    lines.push("");
  } else {
    for (const artifact of bundle.evidenceArtifacts.rows) {
      lines.push(
        `- ${artifact.artifactId} ${artifact.digest} ${artifact.sizeBytes} bytes ${artifact.kind}/${artifact.completeness} (run ${artifact.runId})`,
      );
    }
    lines.push("");
    if (bundle.evidenceArtifacts.truncated) {
      lines.push(
        `_Truncated to the first ${bundle.evidenceArtifacts.rows.length} of ${bundle.evidenceArtifacts.total} artifacts._`,
      );
      lines.push("");
    }
  }
  return `${lines.join("\n")}`;
}
