import { NMAP_MAX_XML_BYTES } from "@blackglass/contracts";
import type { NmapServiceRepository } from "@blackglass/db";

import type { EvidenceStore } from "./evidence-store.js";

export class NmapProjectionService {
  constructor(
    private readonly store: EvidenceStore,
    private readonly repo: NmapServiceRepository,
  ) {}

  async projectForArtifact(
    artifactId: string,
  ): Promise<{ ok: true; skipped?: boolean } | { ok: false; code: "storage_busy" | "invalid_persisted_data" }> {
    const lookup = this.repo.getArtifact(artifactId);
    if (!lookup.ok) return { ok: false, code: lookup.code };
    const row = lookup.row;
    if (row === undefined) return { ok: false, code: "invalid_persisted_data" };
    if (row.artifactSlot !== "nmap-xml" || row.kind !== "tool_raw") return { ok: true, skipped: true };
    if (row.completeness !== "complete") return { ok: true, skipped: true };
    if (row.sizeBytes > NMAP_MAX_XML_BYTES) return { ok: false, code: "invalid_persisted_data" };
    const dl = await this.store.verifiedDownload({
      artifactId: row.artifactId,
      expectedSizeBytes: row.sizeBytes,
      expectedDigest: row.digest,
    });
    if (dl.status !== "ready") return { ok: false, code: "invalid_persisted_data" };
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const c of dl.stream) {
        total += c.length;
        if (total > NMAP_MAX_XML_BYTES) return { ok: false, code: "invalid_persisted_data" };
        chunks.push(c);
      }
    } catch {
      return { ok: false, code: "invalid_persisted_data" };
    }
    const bytes = chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks);
    const res = this.repo.project({ artifactId: row.artifactId, observedAt: row.createdAt, xmlBytes: bytes });
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true };
  }
}
