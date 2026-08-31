import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { engagements, evidenceArtifacts, nmapServices, runs, actions } from "./schema.js";
import type { ParsedNmapService } from "@blackglass/domain";

type Db = BetterSQLite3Database<typeof schema>;

export class NmapServiceRepository {
  constructor(private readonly db: Db) {}
  project(input: { artifactId: string; parserVersion: string; observedAt: string; services: ParsedNmapService[] }): { ok: true } | { ok: false; code: "storage_busy" | "invalid_persisted_data" } {
    if (input.services.length === 0) return { ok: true };
    try {
      this.db.transaction((tx) => {
        for (const s of input.services) {
          tx.insert(nmapServices).values({
            artifactId: input.artifactId,
            parserVersion: input.parserVersion,
            address: s.address,
            port: s.port,
            protocol: s.protocol,
            hostname: s.hostname,
            serviceName: s.serviceName,
            product: s.product,
            version: s.version,
            observedAt: input.observedAt,
          }).onConflictDoNothing().run();
        }
      }, { behavior: "immediate" });
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_TIMEOUT") return { ok: false, code: "storage_busy" };
      return { ok: false, code: "invalid_persisted_data" };
    }
  }
  listForEngagement(engagementId: string): { ok: true; value: Array<{
    source: "nmap"; address: string; port: number; protocol: "tcp"; hostname: string | null; serviceName: string | null; product: string | null; version: string | null;
    parserVersion: string; runId: string; artifactId: string; artifactDigest: string; observedAt: string;
  }> } | { ok: false; code: "storage_busy" | "invalid_persisted_data" | "engagement_not_found" } {
    try {
      const eng = this.db.select().from(engagements).where(eq(engagements.id, engagementId)).get();
      if (eng === undefined) return { ok: false, code: "engagement_not_found" };
      const rows = this.db.select({
        address: nmapServices.address,
        port: nmapServices.port,
        protocol: nmapServices.protocol,
        hostname: nmapServices.hostname,
        serviceName: nmapServices.serviceName,
        product: nmapServices.product,
        version: nmapServices.version,
        parserVersion: nmapServices.parserVersion,
        artifactId: nmapServices.artifactId,
        observedAt: nmapServices.observedAt,
        runId: evidenceArtifacts.runId,
        artifactDigest: evidenceArtifacts.digest,
      }).from(nmapServices)
        .innerJoin(evidenceArtifacts, eq(evidenceArtifacts.artifactId, nmapServices.artifactId))
        .innerJoin(runs, eq(runs.id, evidenceArtifacts.runId))
        .innerJoin(actions, eq(actions.id, runs.actionId))
        .where(and(eq(actions.engagementId, engagementId), eq(runs.engagementId, engagementId)))
        .all();
      const withSource = rows.map((r) => ({ source: "nmap" as const, ...r }));
      return { ok: true, value: withSource as never };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_TIMEOUT") return { ok: false, code: "storage_busy" };
      return { ok: false, code: "invalid_persisted_data" };
    }
  }
}
