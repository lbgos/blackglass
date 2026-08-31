import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  EngagementServicesResponseSchema,
  EvidenceArtifactRecordSchema,
  NMAP_MAX_XML_BYTES,
  NMAP_PARSER_VERSION,
} from "@blackglass/contracts";
import { parseNmapXml } from "@blackglass/domain";
import * as schema from "./schema.js";
import { actions, engagements, evidenceArtifacts, nmapServices, runs } from "./schema.js";
type Db = BetterSQLite3Database<typeof schema>;
export class NmapServiceRepository {
  constructor(private readonly db: Db) {}
  getArtifact(artifactId: string): { ok: true; row: { artifactId: string; artifactSlot: string; kind: string;
  sizeBytes: number; digest: string; completeness: string; createdAt: string } | undefined } | { ok: false; code:
  "storage_busy" | "invalid_persisted_data" } {
    try {
      const raw = this.db.select().from(evidenceArtifacts).where(eq(evidenceArtifacts.artifactId, artifactId)).get();
      if (raw === undefined) return { ok: true, row: undefined };
      const candidate = {
        contractVersion: raw.contractVersion,
        profile: raw.profile,
        artifactId: raw.artifactId,
        runId: raw.runId,
        fence: raw.fence,
        eventSequence: raw.eventSequence,
        artifactSlot: raw.artifactSlot,
        kind: raw.kind,
        sizeBytes: raw.sizeBytes,
        digest: raw.digest,
        relativePath: raw.relativePath,
        completeness: raw.completeness,
        redaction: { applied: Boolean(raw.redactionApplied), boundary: raw.redactionBoundary, rawBytesPreserved:
  Boolean(raw.rawBytesPreserved) },
        createdAt: raw.createdAt,
      };
      const parsed = EvidenceArtifactRecordSchema.safeParse(candidate);
      if (!parsed.success) return { ok: false, code: "invalid_persisted_data" };
      const v = parsed.data;
      return { ok: true, row: { artifactId: v.artifactId, artifactSlot: v.artifactSlot, kind: v.kind, sizeBytes:
  v.sizeBytes, digest: v.digest, completeness: v.completeness, createdAt: v.createdAt } };
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "SQLITE_BUSY" || c === "SQLITE_BUSY_TIMEOUT") return { ok: false, code: "storage_busy" };
      return { ok: false, code: "invalid_persisted_data" };
    }
  }
  project(input: { artifactId: string; observedAt: string; xmlBytes: Uint8Array }): { ok: true } | { ok: false; code:
  "storage_busy" | "invalid_persisted_data" } {
    if (input.xmlBytes.length > NMAP_MAX_XML_BYTES) return { ok: false, code: "invalid_persisted_data" };
    const parsed = parseNmapXml(input.xmlBytes);
    if (!parsed.ok) return { ok: false, code: "invalid_persisted_data" };
    if (parsed.services.length === 0) return { ok: true };
    try {
      this.db.transaction((tx) => {
        for (const s of parsed.services) {
          tx.insert(nmapServices).values({ artifactId: input.artifactId, parserVersion: NMAP_PARSER_VERSION, address:
  s.address, port: s.port, protocol: s.protocol, hostname: s.hostname, serviceName: s.serviceName, product: s.product,
  version: s.version, observedAt: input.observedAt }).onConflictDoNothing().run();
        }
      }, { behavior: "immediate" });
      return { ok: true };
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "SQLITE_BUSY" || c === "SQLITE_BUSY_TIMEOUT") return { ok: false, code: "storage_busy" };
      return { ok: false, code: "invalid_persisted_data" };
    }
  }
  listForEngagement(engagementId: string): { ok: true; value: unknown[] } | { ok: false; code: "engagement_not_found" |
  "storage_busy" | "invalid_persisted_data" } {
    try {
      const eng = this.db.select().from(engagements).where(eq(engagements.id, engagementId)).get();
      if (eng === undefined) return { ok: false, code: "engagement_not_found" };
      const rows = this.db.select({ address: nmapServices.address, port: nmapServices.port, protocol:
  nmapServices.protocol, hostname: nmapServices.hostname, serviceName: nmapServices.serviceName, product:
  nmapServices.product, version: nmapServices.version, parserVersion: nmapServices.parserVersion, artifactId:
  nmapServices.artifactId, observedAt: nmapServices.observedAt, runId: evidenceArtifacts.runId, artifactDigest:
  evidenceArtifacts.digest }).from(nmapServices).innerJoin(evidenceArtifacts, eq(evidenceArtifacts.artifactId,
  nmapServices.artifactId)).innerJoin(runs, eq(runs.id, evidenceArtifacts.runId)).innerJoin(actions, eq(actions.id,
  runs.actionId)).where(and(eq(actions.engagementId, engagementId), eq(runs.engagementId, engagementId))).all();
      const withSource = rows.map((r) => ({ source: "nmap" as const, ...r }));
      const v = EngagementServicesResponseSchema.safeParse(withSource);
      if (!v.success) return { ok: false, code: "invalid_persisted_data" };
      return { ok: true, value: v.data };
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "SQLITE_BUSY" || c === "SQLITE_BUSY_TIMEOUT") return { ok: false, code: "storage_busy" };
      return { ok: false, code: "invalid_persisted_data" };
    }
  }
}
