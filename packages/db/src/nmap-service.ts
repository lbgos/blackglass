import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  EngagementServicesResponseSchema,
  NMAP_MAX_XML_BYTES,
  NMAP_PARSER_VERSION,
} from "@blackglass/contracts";
import { parseNmapXml } from "@blackglass/domain";
import * as schema from "./schema.js";
import { actions, engagements, evidenceArtifacts, nmapServices, runs } from "./schema.js";
type Db = BetterSQLite3Database<typeof schema>;
export class NmapServiceRepository {
  constructor(private readonly db: Db) {}
  getArtifact(artifactId: string) {
    try {
      const row = this.db.select().from(evidenceArtifacts).where(eq(evidenceArtifacts.artifactId, artifactId)).get();
      return { ok: true as const, row };
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "SQLITE_BUSY" || c === "SQLITE_BUSY_TIMEOUT") return { ok: false as const, code: "storage_busy" as const };
      return { ok: false as const, code: "invalid_persisted_data" as const };
    }
  }
  project(input: { artifactId: string; observedAt: string; xmlBytes: Uint8Array }) {
    if (input.xmlBytes.length > NMAP_MAX_XML_BYTES) return { ok: false as const, code: "invalid_persisted_data" as const };
    const parsed = parseNmapXml(input.xmlBytes);
    if (!parsed.ok) return { ok: false as const, code: "invalid_persisted_data" as const };
    if (parsed.services.length === 0) return { ok: true as const };
    try {
      this.db.transaction((tx) => {
        for (const s of parsed.services) {
          tx.insert(nmapServices).values({
            artifactId: input.artifactId,
            parserVersion: NMAP_PARSER_VERSION,
            address: s.address, port: s.port, protocol: s.protocol,
            hostname: s.hostname, serviceName: s.serviceName,
            product: s.product, version: s.version, observedAt: input.observedAt,
          }).onConflictDoNothing().run();
        }
      }, { behavior: "immediate" });
      return { ok: true as const };
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "SQLITE_BUSY" || c === "SQLITE_BUSY_TIMEOUT") return { ok: false as const, code: "storage_busy" as const };
      return { ok: false as const, code: "invalid_persisted_data" as const };
    }
  }
  listForEngagement(engagementId: string) {
    try {
      const eng = this.db.select().from(engagements).where(eq(engagements.id, engagementId)).get();
      if (eng === undefined) return { ok: false as const, code: "engagement_not_found" as const };
      const rows = this.db.select({
        address: nmapServices.address, port: nmapServices.port, protocol: nmapServices.protocol,
        hostname: nmapServices.hostname, serviceName: nmapServices.serviceName,
        product: nmapServices.product, version: nmapServices.version,
        parserVersion: nmapServices.parserVersion, artifactId: nmapServices.artifactId,
        observedAt: nmapServices.observedAt, runId: evidenceArtifacts.runId, artifactDigest: evidenceArtifacts.digest,
      }).from(nmapServices)
        .innerJoin(evidenceArtifacts, eq(evidenceArtifacts.artifactId, nmapServices.artifactId))
        .innerJoin(runs, eq(runs.id, evidenceArtifacts.runId))
        .innerJoin(actions, eq(actions.id, runs.actionId))
        .where(and(eq(actions.engagementId, engagementId), eq(runs.engagementId, engagementId))).all();
      const withSource = rows.map((r) => ({ source: "nmap" as const, ...r }));
      const v = EngagementServicesResponseSchema.safeParse(withSource);
      if (!v.success) return { ok: false as const, code: "invalid_persisted_data" as const };
      return { ok: true as const, value: v.data };
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "SQLITE_BUSY" || c === "SQLITE_BUSY_TIMEOUT") return { ok: false as const, code: "storage_busy" as const };
      return { ok: false as const, code: "invalid_persisted_data" as const };
    }
  }
}
