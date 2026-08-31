import { createHash } from "node:crypto";
import { chmod } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import { chmodSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EngagementRepository, NmapServiceRepository, openEngagementDatabase } from "@blackglass/db";
import { loadEvidenceNative } from "@blackglass/evidence-native";
import { EvidenceStore } from "./evidence-store.js";
import { NmapProjectionService } from "./nmap-projection.js";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "nmap-proj-"));
  await chmod(dir, 0o700);
  const db = openEngagementDatabase({ dataDirectory: dir });
  const engRepo = new EngagementRepository(db.db);
  const repo = new NmapServiceRepository(db.db);
  const eng = engRepo.createEngagement({ name: "L", kind: "lab", autoContinueWarnings: false });
  if (!eng.ok) throw new Error("eng");
  const native = loadEvidenceNative(); if (!native.ok) throw new Error("native");
  const storeRes = EvidenceStore.open(dir, native.binding); if (!storeRes.ok) throw new Error("store");
  return { dir, db, engRepo, repo, store: storeRes.store, engId: eng.value.id };
}
async function publish(dir: string, id: string, _runId: string, xml: Buffer) {
  const digest = `sha256:${createHash("sha256").update(xml).digest("hex")}`;
  const fh = await open(path.join(dir, "evidence", "published", id), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
  await fh.write(xml); await fh.sync(); await fh.close(); chmodSync(path.join(dir, "evidence", "published", id), 0o600);
  return digest;
}
describe("nmap projection", () => {
  it("projects valid, empty, rejects malformed and skips partial", async () => {
    const f = await fixture();
    const aid = "00000000-0000-4000-8000-000000000001";
    const runId = "run-1";
    f.db.sqlite.prepare("insert into actions (id, contract_version, engagement_id, revision, state, queued_snapshot_version, warning_interactions, run_state, resume_requested, cleanup_required, capability_error_code, pending_warning_json, created_at, updated_at) values (?,1,?,1,'active',1,0,'running',0,0,null,null,?,?)").run("act-1", f.engId, new Date().toISOString(), new Date().toISOString());
    f.db.sqlite.prepare("insert into runs (id, contract_version, action_id, engagement_id, attempt, state, current_lease_id, current_fence, terminal_kind, terminal_reason, created_at, updated_at) values (?,1,?, ?,1,'running','lease-1','1',null,null,?,?)").run(runId, "act-1", f.engId, new Date().toISOString(), new Date().toISOString());
    const xml = Buffer.from(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.10" addrtype="ipv4"/><ports><port protocol="tcp" portid="80"><state state="open"/><service name="http"/></port></ports></host></nmaprun>`);
    const digest = await publish(f.dir, aid, runId, xml);
    f.db.sqlite.prepare("insert into evidence_artifacts (artifact_id, contract_version, profile, run_id, fence, event_sequence, artifact_slot, kind, size_bytes, digest, relative_path, completeness, redaction_applied, redaction_boundary, raw_bytes_preserved, created_at) values (?,1,'d3-v1',?,'1',1,'nmap-xml','tool_raw',?,?,?, 'complete',0,'none',1,?)").run(aid, runId, xml.length, digest, `published/${aid}`, new Date().toISOString());
    const proj = new NmapProjectionService(f.store, f.repo);
    expect((await proj.projectForArtifact(aid)).ok).toBe(true);
    expect(f.repo.listForEngagement(f.engId).ok && (f.repo.listForEngagement(f.engId) as {ok:true,value:unknown[]}).value.length).toBe(1);
    expect((await proj.projectForArtifact(aid)).ok).toBe(true);
    // empty
    f.db.sqlite.prepare("insert into actions (id, contract_version, engagement_id, revision, state, queued_snapshot_version, warning_interactions, run_state, resume_requested, cleanup_required, capability_error_code, pending_warning_json, created_at, updated_at) values (?,1,?,1,'active',1,0,'running',0,0,null,null,?,?)").run("act-2", f.engId, new Date().toISOString(), new Date().toISOString());
    f.db.sqlite.prepare("insert into runs (id, contract_version, action_id, engagement_id, attempt, state, current_lease_id, current_fence, terminal_kind, terminal_reason, created_at, updated_at) values (?,1,?, ?,1,'running','lease-2','1',null,null,?,?)").run("run-2", "act-2", f.engId, new Date().toISOString(), new Date().toISOString());
    const empty = Buffer.from(`<?xml version="1.0"?><nmaprun></nmaprun>`); const d2 = await publish(f.dir, "00000000-0000-4000-8000-000000000002", "run-2", empty);
    f.db.sqlite.prepare("insert into evidence_artifacts (artifact_id, contract_version, profile, run_id, fence, event_sequence, artifact_slot, kind, size_bytes, digest, relative_path, completeness, redaction_applied, redaction_boundary, raw_bytes_preserved, created_at) values (?,1,'d3-v1',?,'1',1,'nmap-xml','tool_raw',?,?,?, 'complete',0,'none',1,?)").run("00000000-0000-4000-8000-000000000002", "run-2", empty.length, d2, `published/00000000-0000-4000-8000-000000000002`, new Date().toISOString());
    expect((await proj.projectForArtifact("00000000-0000-4000-8000-000000000002")).ok).toBe(true);
    // malformed
    f.db.sqlite.prepare("insert into actions (id, contract_version, engagement_id, revision, state, queued_snapshot_version, warning_interactions, run_state, resume_requested, cleanup_required, capability_error_code, pending_warning_json, created_at, updated_at) values (?,1,?,1,'active',1,0,'running',0,0,null,null,?,?)").run("act-3", f.engId, new Date().toISOString(), new Date().toISOString());
    f.db.sqlite.prepare("insert into runs (id, contract_version, action_id, engagement_id, attempt, state, current_lease_id, current_fence, terminal_kind, terminal_reason, created_at, updated_at) values (?,1,?, ?,1,'running','lease-3','1',null,null,?,?)").run("run-3", "act-3", f.engId, new Date().toISOString(), new Date().toISOString());
    const bad = Buffer.from(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.1" addrtype="ipv4"><port></nmaprun>`); const d3 = await publish(f.dir, "00000000-0000-4000-8000-000000000003", "run-3", bad);
    f.db.sqlite.prepare("insert into evidence_artifacts (artifact_id, contract_version, profile, run_id, fence, event_sequence, artifact_slot, kind, size_bytes, digest, relative_path, completeness, redaction_applied, redaction_boundary, raw_bytes_preserved, created_at) values (?,1,'d3-v1',?,'1',1,'nmap-xml','tool_raw',?,?,?, 'complete',0,'none',1,?)").run("00000000-0000-4000-8000-000000000003", "run-3", bad.length, d3, `published/00000000-0000-4000-8000-000000000003`, new Date().toISOString());
    expect((await proj.projectForArtifact("00000000-0000-4000-8000-000000000003")).ok).toBe(false);
    // partial skip
    f.db.sqlite.prepare("insert into actions (id, contract_version, engagement_id, revision, state, queued_snapshot_version, warning_interactions, run_state, resume_requested, cleanup_required, capability_error_code, pending_warning_json, created_at, updated_at) values (?,1,?,1,'active',1,0,'running',0,0,null,null,?,?)").run("act-4", f.engId, new Date().toISOString(), new Date().toISOString());
    f.db.sqlite.prepare("insert into runs (id, contract_version, action_id, engagement_id, attempt, state, current_lease_id, current_fence, terminal_kind, terminal_reason, created_at, updated_at) values (?,1,?, ?,1,'running','lease-4','1',null,null,?,?)").run("run-4", "act-4", f.engId, new Date().toISOString(), new Date().toISOString());
    f.db.sqlite.prepare("insert into evidence_artifacts (artifact_id, contract_version, profile, run_id, fence, event_sequence, artifact_slot, kind, size_bytes, digest, relative_path, completeness, redaction_applied, redaction_boundary, raw_bytes_preserved, created_at) values (?,1,'d3-v1',?,'1',1,'nmap-xml','tool_raw',?,?,?, 'partial',0,'none',1,?)").run("00000000-0000-4000-8000-000000000004", "run-4", bad.length, d3, `published/00000000-0000-4000-8000-000000000004`, new Date().toISOString());
    const pub4 = path.join(f.dir, "evidence", "published", "00000000-0000-4000-8000-000000000004"); const fh4 = await open(pub4, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600); await fh4.write(bad); await fh4.sync(); await fh4.close(); chmodSync(pub4, 0o600);
    expect((await proj.projectForArtifact("00000000-0000-4000-8000-000000000004")).ok).toBe(true);
    expect(f.repo.listForEngagement("00000000-0000-4000-8000-000000009999").ok).toBe(false);
    f.db.close(); await rm(f.dir, { recursive: true, force: true });
  });
  it("GET services is engagement-scoped", async () => {
    const f = await fixture();
    const { buildApp } = await import("../app.js");
    const runId = "run-http-1";
    f.db.sqlite.prepare("insert into actions (id, contract_version, engagement_id, revision, state, queued_snapshot_version, warning_interactions, run_state, resume_requested, cleanup_required, capability_error_code, pending_warning_json, created_at, updated_at) values (?,1,?,1,'active',1,0,'running',0,0,null,null,?,?)").run("act-http-1", f.engId, new Date().toISOString(), new Date().toISOString());
    f.db.sqlite.prepare("insert into runs (id, contract_version, action_id, engagement_id, attempt, state, current_lease_id, current_fence, terminal_kind, terminal_reason, created_at, updated_at) values (?,1,?, ?,1,'running','lease-x','1',null,null,?,?)").run(runId, "act-http-1", f.engId, new Date().toISOString(), new Date().toISOString());
    const xml = Buffer.from(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.5" addrtype="ipv4"/><ports><port protocol="tcp" portid="8080"><state state="open"/><service name="http-proxy"/></port></ports></host></nmaprun>`);
    const digest = await publish(f.dir, "00000000-0000-4000-8000-000000000011", runId, xml);
    f.db.sqlite.prepare("insert into evidence_artifacts (artifact_id, contract_version, profile, run_id, fence, event_sequence, artifact_slot, kind, size_bytes, digest, relative_path, completeness, redaction_applied, redaction_boundary, raw_bytes_preserved, created_at) values (?,1,'d3-v1',?,'1',1,'nmap-xml','tool_raw',?,?,?, 'complete',0,'none',1,?)").run("00000000-0000-4000-8000-000000000011", runId, xml.length, digest, `published/00000000-0000-4000-8000-000000000011`, new Date().toISOString());
    await new NmapProjectionService(f.store, f.repo).projectForArtifact("00000000-0000-4000-8000-000000000011");
    const eng2 = f.engRepo.createEngagement({ name: "E2", kind: "lab", autoContinueWarnings: false }); if (!eng2.ok) throw new Error("e2");
    const app = buildApp({ engagementRepository: f.engRepo, getDevelopmentStorageReadiness: () => "ready" as const, nmapServiceRepository: f.repo });
    expect((await app.inject({ method: "GET", url: `/api/v1/engagements/${f.engId}/services` })).json().length).toBe(1);
    expect((await app.inject({ method: "GET", url: `/api/v1/engagements/${eng2.value.id}/services` })).json().length).toBe(0);
    expect((await app.inject({ method: "GET", url: `/api/v1/engagements/00000000-0000-4000-8000-000000009999/services` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/engagements/not-a-uuid/services` })).statusCode).toBe(400);
    await app.close(); f.db.close(); await rm(f.dir, { recursive: true, force: true });
  });
});
