import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishEvidenceArtifacts } from "./evidence-client.js";
let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function captureCompleteness(exitCode: number | null) {
  dir = path.join(tmpdir(), `runner-nmap-${Date.now()}-${exitCode}`);
  await mkdir(dir, { recursive: true });
  const lease = { runId: "run-1", leaseId: "lease-1", sessionId: "sess-1", fence: "1" };
  const config = { dataDir: dir, runnerId: "runner-1", secret: "a".repeat(43), apiBaseUrl: "http://127.0.0.1:9" } as unknown as import("./config.js").RunnerConfig;
  const result = { stdout: Buffer.from("out"), stderr: Buffer.from("err"), stdoutMeta: { truncated: false }, stderrMeta: { truncated: false }, exitCode } as unknown as import("./process.js").ProcessResult;
  const grantMap = new Map<string, { artifactId: string; uploadId: string }>();
  const completes: Array<{ uploadId: string; sizeBytes: number; digest: string; completeness: string }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/artifacts/grants")) {
      const b = JSON.parse(String(init?.body ?? "{}")); const slot = b.artifactSlot;
      const aid = slot === "nmap-xml" ? "00000000-0000-4000-8000-000000000003" : slot === "stderr" ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001";
      const uid = slot === "nmap-xml" ? "00000000-0000-4000-8000-000000000013" : slot === "stderr" ? "00000000-0000-4000-8000-000000000012" : "00000000-0000-4000-8000-000000000011";
      const g = { artifactId: aid, uploadId: uid, runId: "run-1", leaseId: "lease-1", sessionId: "sess-1", fence: "1", eventSequence: 1, artifactSlot: slot, kind: b.kind, declaredSizeBytes: b.declaredSizeBytes, declaredDigest: b.declaredDigest, originalFileName: slot === "nmap-xml" ? "nmap.xml" : `${slot}.log`, declaredContentType: slot === "nmap-xml" ? "application/xml" : "text/plain; charset=utf-8", createdAt: new Date().toISOString() };
      grantMap.set(uid, { artifactId: aid, uploadId: uid }); return new Response(JSON.stringify(g), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/uploads/") && init?.method === "PUT") return new Response(null, { status: 204 });
    if (u.includes("/complete")) { const b = JSON.parse(String(init?.body ?? "{}")); completes.push(b); let aid = "00000000-0000-4000-8000-000000000001"; if (b.uploadId === "00000000-0000-4000-8000-000000000012") aid = "00000000-0000-4000-8000-000000000002"; if (b.uploadId === "00000000-0000-4000-8000-000000000013") aid = "00000000-0000-4000-8000-000000000003"; return new Response(JSON.stringify({ disposition: "published", artifactId: aid, sizeBytes: b.sizeBytes, digest: b.digest, completeness: b.completeness }), { status: 200, headers: { "content-type": "application/json" } }); }
    return new Response(JSON.stringify({ code: "invalid_request" }), { status: 400 });
  }) as unknown as typeof fetch;
  const xml = Buffer.from("<nmaprun></nmaprun>");
  await publishEvidenceArtifacts(config, lease as unknown as { runId: string; leaseId: string; sessionId: string; fence: string }, result, { isCancelled: false, nmapXml: xml, nmapExitCode: exitCode });
  globalThis.fetch = origFetch;
  const nmapComplete = completes.find((c) => c.uploadId === "00000000-0000-4000-8000-000000000013");
  return nmapComplete?.completeness as string;
}
describe("runner nmap completeness", () => {
  it("nonzero exit publishes partial, zero exit publishes complete", async () => {
    expect(await captureCompleteness(1)).toBe("partial");
    expect(await captureCompleteness(0)).toBe("complete");
    expect(await captureCompleteness(null)).toBe("complete");
  });
});
