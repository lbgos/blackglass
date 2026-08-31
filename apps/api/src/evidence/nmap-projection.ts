import { NMAP_PARSER_VERSION, parseNmapXml } from "@blackglass/domain";
import { evidenceArtifacts } from "@blackglass/db";
import type { EvidenceStore } from "./evidence-store.js";
import type { NmapServiceRepository } from "@blackglass/db";

export class NmapProjectionService {
  constructor(private readonly loadArtifact: (id: string) => typeof evidenceArtifacts.$inferSelect | undefined, private readonly store: EvidenceStore, private readonly repo: NmapServiceRepository) {}
  async projectForArtifact(artifactId: string): Promise<{ ok: true; skipped?: boolean } | { ok: false; code: "storage_busy" | "invalid_persisted_data" }> {
    let row: typeof evidenceArtifacts.$inferSelect | undefined;
    try { row = this.loadArtifact(artifactId); } catch { return { ok: false, code: "invalid_persisted_data" }; }
    if (row === undefined) return { ok: false, code: "invalid_persisted_data" };
    if (row.artifactSlot !== "nmap-xml" || row.kind !== "tool_raw") return { ok: true, skipped: true };
    if (row.completeness !== "complete") return { ok: true, skipped: true };
    const dl = await this.store.verifiedDownload({ artifactId: row.artifactId, expectedSizeBytes: row.sizeBytes, expectedDigest: row.digest });
    if (dl.status !== "ready") return { ok: false, code: "invalid_persisted_data" };
    const chunks: Buffer[] = []; let total = 0;
    try {
      for await (const c of dl.stream) { total += c.length; if (total > 16 * 1024 * 1024) return { ok: false, code: "invalid_persisted_data" }; chunks.push(c); }
    } catch { return { ok: false, code: "invalid_persisted_data" }; }
    const bytes = chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks);
    const parsed = parseNmapXml(bytes);
    if (!parsed.ok) return { ok: false, code: "invalid_persisted_data" };
    const res = this.repo.project({ artifactId: row.artifactId, parserVersion: NMAP_PARSER_VERSION, observedAt: row.createdAt, services: parsed.services });
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true };
  }
}
