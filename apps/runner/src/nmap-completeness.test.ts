import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishEvidenceArtifacts } from "./evidence-client.js";
let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function captureCompleteness(exitCode: number | null, isCancelled: boolean) {
  dir = path.join(tmpdir(), `runner-nmap-${Date.now()}-${exitCode}-${isCancelled}`);
  await mkdir(dir, { recursive: true });
  const lease = { runId: "run-1", leaseId: "lease-1", sessionId: "sess-1", fence: "1" };
  const config = { dataDir: dir, runnerId: "runner-1", secret: "a".repeat(43), apiBaseUrl: "http://127.0.0.1:9" } as unknown as import("./config.js").RunnerConfig;
  const result = { stdout: Buffer.from("out"), stderr: Buffer.from("err"), stdoutMeta: { truncated: false }, stderrMeta: { truncated: false }, exitCode } as unknown as import("./process.js").ProcessResult;
  const completes: Array<{ uploadId: string; completeness: string }> = [];
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/artifacts/grants")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const slot = body.artifactSlot;
        const aid = slot === "nmap-xml" ? "00000000-0000-4000-8000-000000000003" : slot === "stderr" ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001";
        const uid = slot === "nmap-xml" ? "00000000-0000-4000-8000-000000000013" : slot === "stderr" ? "00000000-0000-4000-8000-000000000012" : "00000000-0000-4000-8000-000000000011";
        const grant = { artifactId: aid, uploadId: uid, runId: "run-1", leaseId: "lease-1", sessionId: "sess-1", fence: "1", eventSequence: body.eventSequence, artifactSlot: slot, kind: body.kind, declaredSizeBytes: body.declaredSizeBytes, declaredDigest: body.declaredDigest, originalFileName: slot === "nmap-xml" ? "nmap.xml" : `${slot}.log`, declaredContentType: slot === "nmap-xml" ? "application/xml" : "text/plain; charset=utf-8", createdAt: new Date().toISOString() };
        return new Response(JSON.stringify(grant), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (u.includes("/uploads/") && init?.method === "PUT") return new Response(null, { status: 204 });
      if (u.includes("/complete")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        completes.push(body);
        const aid = body.uploadId === "00000000-0000-4000-8000-000000000013" ? "00000000-0000-4000-8000-000000000003" : body.uploadId === "00000000-0000-4000-8000-000000000012" ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001";
        return new Response(JSON.stringify({ disposition: "published", artifactId: aid, sizeBytes: body.sizeBytes, digest: body.digest, completeness: body.completeness }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ code: "invalid_request" }), { status: 400 });
    }) as unknown as typeof fetch;
    const xml = Buffer.from("<nmaprun></nmaprun>");
    await publishEvidenceArtifacts(config, lease as unknown as { runId: string; leaseId: string; sessionId: string; fence: string }, result, { isCancelled, eventSequence: 2, nmapXml: xml, nmapExitCode: exitCode });
    const found = completes.find((c) => c.uploadId === "00000000-0000-4000-8000-000000000013");
    return found?.completeness as string;
  } finally { globalThis.fetch = origFetch; }
}
describe("runner nmap completeness", () => {
  it("nonzero exit publishes partial, zero complete, cancelled zero partial", async () => {
    expect(await captureCompleteness(1, false)).toBe("partial");
    expect(await captureCompleteness(0, false)).toBe("complete");
    expect(await captureCompleteness(0, true)).toBe("partial");
    expect(await captureCompleteness(null, false)).toBe("complete");
  });
});
