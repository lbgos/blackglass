import { describe, expect, it } from "vitest";

import {
  assembleAdvisorContext,
  type AdvisorContextDeps,
} from "./advisor-context.js";

const ENGAGEMENT = "10000000-0000-4000-8000-000000000001";
const FINDING = "20000000-0000-4000-8000-000000000001";
const DIGEST = `sha256:${"ab".repeat(32)}`;
const SECRET = "flag{synthetic-fixture-0003}";

interface FakeState {
  artifacts: Map<string, { sizeBytes: number; digest: string }>;
  findings: Map<string, { id: string; title: string; body: string }>;
  excerpts: Map<string, { content: Uint8Array; totalBytes: number; truncated: boolean }>;
  missing: Set<string>;
  corrupt: Set<string>;
  excerptCalls: string[];
  engagementCalls: number;
  engagementArchived: boolean;
}

function makeDeps(state: FakeState): AdvisorContextDeps {
  return {
    engagements: {
      getEngagement: (engagementId: string) => {
        state.engagementCalls += 1;
        if (engagementId !== ENGAGEMENT) {
          return { ok: false as const, error: { code: "engagement_not_found" } };
        }
        return { ok: true as const, value: { status: state.engagementArchived ? "archived" : "active" } };
      },
      getFindingForEngagement: (engagementId: string, findingId: string) => {
        if (engagementId !== ENGAGEMENT) {
          return { ok: false as const, error: { code: "engagement_not_found" } };
        }
        const finding = state.findings.get(findingId);
        if (finding === undefined) {
          return { ok: false as const, error: { code: "finding_not_found" } };
        }
        return { ok: true as const, value: finding };
      },
    },
    artifacts: {
      publishedArtifactForEngagement: ({ engagementId, artifactId }) => {
        if (engagementId !== ENGAGEMENT) return undefined;
        const record = state.artifacts.get(artifactId);
        if (record === undefined) return undefined;
        return { artifactId, sizeBytes: record.sizeBytes, digest: record.digest };
      },
    },
    excerpts: {
      verifiedExcerpt: async ({ artifactId }) => {
        state.excerptCalls.push(artifactId);
        if (state.missing.has(artifactId)) return { status: "missing" as const };
        if (state.corrupt.has(artifactId)) {
          return { status: "corrupt" as const, code: "artifact_symlink_rejected" };
        }
        const excerpt = state.excerpts.get(artifactId);
        if (excerpt === undefined) return { status: "missing" as const };
        return { status: "ready" as const, ...excerpt };
      },
    },
  };
}

function emptyState(): FakeState {
  return {
    artifacts: new Map(),
    findings: new Map(),
    excerpts: new Map(),
    missing: new Set(),
    corrupt: new Set(),
    excerptCalls: [],
    engagementCalls: 0,
    engagementArchived: false,
  };
}

function ownedArtifact(id: string, text: string): {
  record: { sizeBytes: number; digest: string };
  excerpt: { content: Uint8Array; totalBytes: number; truncated: boolean };
} {
  const content = new TextEncoder().encode(text);
  return {
    record: { sizeBytes: content.length, digest: DIGEST },
    excerpt: { content, totalBytes: content.length, truncated: false },
  };
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    engagementId: ENGAGEMENT,
    question: "What does this evidence show?",
    excerptArtifactIds: ["nmap-xml-1"],
    findingIds: [] as string[],
    ...overrides,
  };
}

describe("advisor context assembly", () => {
  it("assembles redacted output with no raw leakage", async () => {
    const state = emptyState();
    const owned = ownedArtifact("nmap-xml-1", `banner with ${SECRET} inside`);
    state.artifacts.set("nmap-xml-1", owned.record);
    state.excerpts.set("nmap-xml-1", owned.excerpt);
    state.findings.set(FINDING, { id: FINDING, title: "Banner", body: "Port 80 open." });
    const result = await assembleAdvisorContext(
      {
        request: validRequest({ findingIds: [FINDING] }),
        history: [{ question: "Earlier?", answer: "Earlier answer." }],
      },
      makeDeps(state),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.suppliedIds).toEqual([
      { kind: "artifact", id: "nmap-xml-1" },
      { kind: "finding", id: FINDING },
    ]);
    expect(result.value.redactions).toBeGreaterThan(0);
    expect(result.value.prompt.user).not.toContain(SECRET);
    expect(result.value.prompt.user).toContain("[redacted]");
    expect(result.value.excerpts).toEqual([{ id: "nmap-xml-1", truncated: false, totalBytes: owned.record.sizeBytes }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("What does this evidence show?");
    expect("blocks" in result.value).toBe(false);
  });

  it("reads archived engagements", async () => {
    const state = emptyState();
    state.engagementArchived = true;
    const owned = ownedArtifact("nmap-xml-1", "banner");
    state.artifacts.set("nmap-xml-1", owned.record);
    state.excerpts.set("nmap-xml-1", owned.excerpt);
    const result = await assembleAdvisorContext(
      { request: validRequest(), history: [] },
      makeDeps(state),
    );
    expect(result.ok).toBe(true);
  });

  it("touches no store bytes for unknown or foreign ids in any order", async () => {
    for (const excerptArtifactIds of [["nmap-xml-1", "foreign-1"], ["foreign-1", "nmap-xml-1"]]) {
      const state = emptyState();
      const owned = ownedArtifact("nmap-xml-1", "banner");
      state.artifacts.set("nmap-xml-1", owned.record);
      state.excerpts.set("nmap-xml-1", owned.excerpt);
      const result = await assembleAdvisorContext(
        { request: validRequest({ excerptArtifactIds }), history: [] },
        makeDeps(state),
      );
      expect(result).toEqual({ ok: false, error: { code: "unknown_artifact" } });
      expect(state.excerptCalls).toEqual([]);
    }
  });

  it("rejects unknown findings without store reads", async () => {
    const state = emptyState();
    const owned = ownedArtifact("nmap-xml-1", "banner");
    state.artifacts.set("nmap-xml-1", owned.record);
    state.excerpts.set("nmap-xml-1", owned.excerpt);
    const result = await assembleAdvisorContext(
      { request: validRequest({ findingIds: [FINDING] }), history: [] },
      makeDeps(state),
    );
    expect(result).toEqual({ ok: false, error: { code: "unknown_finding" } });
    expect(state.excerptCalls).toEqual([]);
  });

  it("maps store missing and corrupt outcomes", async () => {
    for (const [setup, code] of [
      [(state: FakeState) => state.missing.add("nmap-xml-1"), "missing_artifact"],
      [(state: FakeState) => state.corrupt.add("nmap-xml-1"), "corrupt_artifact"],
    ] as const) {
      const state = emptyState();
      const owned = ownedArtifact("nmap-xml-1", "banner");
      state.artifacts.set("nmap-xml-1", owned.record);
      state.excerpts.set("nmap-xml-1", owned.excerpt);
      setup(state);
      const result = await assembleAdvisorContext(
        { request: validRequest(), history: [] },
        makeDeps(state),
      );
      expect(result).toEqual({ ok: false, error: { code } });
    }
  });

  it("rejects invalid requests and history before any dependency", async () => {
    const cases: Array<{ request: unknown; history: readonly unknown[] }> = [
      { request: { ...validRequest(), question: "  padded  " }, history: [] },
      { request: { ...validRequest(), excerptArtifactIds: [] }, history: [] },
      { request: { ...validRequest(), excerptArtifactIds: ["a-1", "a-1"] }, history: [] },
      {
        request: validRequest(),
        history: Array.from({ length: 11 }, () => ({ question: "q", answer: "a" })),
      },
      { request: validRequest(), history: [{ question: "q", answer: "x".repeat(2001) }] },
      { request: validRequest(), history: ["not-an-object"] },
    ];
    for (const input of cases) {
      const state = emptyState();
      const result = await assembleAdvisorContext(input, makeDeps(state));
      expect(result).toEqual({ ok: false, error: { code: "invalid_input" } });
      expect(state.engagementCalls).toBe(0);
      expect(state.excerptCalls).toEqual([]);
    }
  });

  it("marks truncation truthfully and enforces the prompt budget", async () => {
    const state = emptyState();
    const big = new Uint8Array(6_000).fill(120);
    state.artifacts.set("nmap-xml-1", { sizeBytes: 6_000, digest: DIGEST });
    state.excerpts.set("nmap-xml-1", { content: big.slice(0, 4_096), totalBytes: 6_000, truncated: true });
    const truncated = await assembleAdvisorContext(
      { request: validRequest(), history: [] },
      makeDeps(state),
    );
    expect(truncated.ok).toBe(true);
    if (!truncated.ok) return;
    expect(truncated.value.excerpts).toEqual([{ id: "nmap-xml-1", truncated: true, totalBytes: 6_000 }]);
    expect(truncated.value.prompt.user).toContain("[excerpt truncated: first 4096 of 6000 bytes]");

    const oversized = emptyState();
    for (let index = 0; index < 4; index += 1) {
      const id = `artifact-${index}`;
      const content = new Uint8Array(4_096).fill(120);
      oversized.artifacts.set(id, { sizeBytes: 4_096, digest: DIGEST });
      oversized.excerpts.set(id, { content, totalBytes: 4_096, truncated: false });
    }
    for (let index = 0; index < 8; index += 1) {
      const id = `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      oversized.findings.set(id, { id, title: "Finding", body: "x".repeat(2_000) });
    }
    const ids = [...oversized.findings.keys()];
    const overBudget = await assembleAdvisorContext(
      {
        request: validRequest({
          excerptArtifactIds: ["artifact-0", "artifact-1", "artifact-2", "artifact-3"],
          findingIds: ids,
        }),
        history: [],
      },
      makeDeps(oversized),
    );
    expect(overBudget).toEqual({ ok: false, error: { code: "context_too_large" } });
  });

  it("clips long finding bodies with a codepoint-safe marker", async () => {
    const state = emptyState();
    const owned = ownedArtifact("nmap-xml-1", "banner");
    state.artifacts.set("nmap-xml-1", owned.record);
    state.excerpts.set("nmap-xml-1", owned.excerpt);
    state.findings.set(FINDING, { id: FINDING, title: "Long", body: `é${"x".repeat(3_000)}` });
    const result = await assembleAdvisorContext(
      { request: validRequest({ findingIds: [FINDING] }), history: [] },
      makeDeps(state),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt.user).toContain("[truncated]");
    expect(result.value.prompt.user).toContain("é");
  });
});
