import { describe, expect, it } from "vitest";

import type { ReportBundle } from "@blackglass/contracts";

import { maskReportBundle } from "./report-mask.js";

const engagementId = "10000000-0000-4000-8000-000000000001";

function bundleFixture(): ReportBundle {
  return {
    contractVersion: 1,
    engagement: {
      id: engagementId,
      name: "Target lab",
      kind: "lab",
      status: "active",
      description: "auth flag{synthetic-share-0003}",
      authorizationContext: null,
      deadlineAt: null,
      revision: 1,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    },
    findings: [
      {
        contractVersion: 1,
        id: "20000000-0000-4000-8000-000000000001",
        engagementId,
        title: "Creds password=synthetic-share-002",
        severity: "high",
        status: "open",
        body: "detail",
        evidenceArtifactIds: [],
        createdAt: "2026-08-12T12:00:00.000Z",
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
    ],
    notesMarkdown: "see flag{synthetic-share-0001}",
    notesUpdatedAt: "2026-08-12T12:00:00.000Z",
    services: {
      total: 1,
      truncated: false,
      rows: [
        {
          address: "192.0.2.10",
          port: 80,
          protocol: "tcp",
          hostname: null,
          serviceName: "http",
          product: "SyntheticServer flag{synthetic-structured-0001}",
          version: "1.0",
          source: "nmap",
          parserVersion: "nmap-xml-v1",
          runId: "run-1",
          artifactId: "artifact-1",
          artifactDigest: `sha256:${"a".repeat(64)}`,
          observedAt: "2026-08-12T12:00:00.000Z",
        },
      ],
    },
    probes: { total: 0, truncated: false, rows: [] },
    ffufResults: { total: 0, truncated: false, rows: [] },
    evidenceArtifacts: { total: 0, truncated: false, rows: [] },
    generatedAt: "2026-08-12T13:00:00.000Z",
  };
}

describe("maskReportBundle", () => {
  it("masks operator free text while preserving structured rows and identity", () => {
    const bundle = bundleFixture();
    const masked = maskReportBundle(bundle);

    expect(masked.redactions).toBe(3);
    expect(masked.bundle.notesMarkdown).toBe("see [redacted]");
    expect(masked.bundle.findings[0]?.title).toBe("Creds password: [redacted]");
    expect(masked.bundle.findings[0]?.body).toBe("detail");
    expect(masked.bundle.engagement.description).toBe("auth [redacted]");
    expect(masked.bundle.engagement.authorizationContext).toBe(null);

    // Structured discovery text is intentionally preserved verbatim.
    expect(masked.bundle.services.rows[0]?.product).toBe(
      "SyntheticServer flag{synthetic-structured-0001}",
    );
    expect(masked.bundle.services).toBe(bundle.services);
    expect(masked.bundle.probes).toBe(bundle.probes);
    expect(masked.bundle.ffufResults).toBe(bundle.ffufResults);
    expect(masked.bundle.evidenceArtifacts).toBe(bundle.evidenceArtifacts);

    // Identity metadata is byte-exact.
    expect(masked.bundle.engagement.id).toBe(bundle.engagement.id);
    expect(masked.bundle.engagement.name).toBe(bundle.engagement.name);
    expect(masked.bundle.findings[0]?.id).toBe(bundle.findings[0]?.id);
    expect(masked.bundle.generatedAt).toBe(bundle.generatedAt);

    // The stored bundle is never mutated.
    expect(bundle.notesMarkdown).toBe("see flag{synthetic-share-0001}");
    expect(bundle.findings[0]?.title).toBe("Creds password=synthetic-share-002");
  });

  it("passes null context and secret-free text through with zero redactions", () => {
    const bundle: ReportBundle = {
      ...bundleFixture(),
      engagement: {
        ...bundleFixture().engagement,
        description: null,
        authorizationContext: null,
      },
      findings: [],
      notesMarkdown: "Port 80 open. Title: Synthetic Router Login.",
    };
    const masked = maskReportBundle(bundle);

    expect(masked.redactions).toBe(0);
    expect(masked.bundle.notesMarkdown).toBe(bundle.notesMarkdown);
    expect(masked.bundle.engagement.description).toBe(null);
  });

  it("strips credentialed urls from operator text", () => {
    const bundle: ReportBundle = {
      ...bundleFixture(),
      findings: [],
      notesMarkdown: "see http://admin:synthetic@192.0.2.10/login for details",
    };
    const masked = maskReportBundle(bundle);

    expect(masked.bundle.notesMarkdown).toBe("see http://192.0.2.10/login for details");
  });
});
