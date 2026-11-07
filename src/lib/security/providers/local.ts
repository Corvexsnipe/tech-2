import type { IpCategory } from "@prisma/client";
import { db } from "../../db";
import { securityConfig } from "../config";
import { failedResult, SIGNAL_WEIGHTS, type CheckInput, type IntelligenceProvider, type ProviderResult, type Signal } from "./types";

interface Row { category: IpCategory; source: string; confidence: number; cidr: string; metadata: Record<string, unknown> | null }

// Freshness of the local dataset: the newest successful import across
// enabled feeds, compared against ANTI_VPN_MAX_DATA_AGE_HOURS. An empty or
// expired dataset can never clear a review.
export async function datasetFreshness() {
  const feeds = await db().ipIntelligenceFeed.findMany({ where: { enabled: true }, select: { source: true, lastSuccessAt: true, category: true } });
  const successes = feeds.map(f => f.lastSuccessAt).filter((d): d is Date => !!d);
  const newest = successes.length ? new Date(Math.max(...successes.map(d => d.getTime()))) : null;
  const maxAgeMs = securityConfig().maxDataAgeHours * 3600_000;
  const stale = !newest || Date.now() - newest.getTime() > maxAgeMs;
  return { newest, stale, version: newest ? newest.toISOString() : null, feeds: feeds.length, imported: successes.length };
}

async function matches(ip: string, categories: IpCategory[]): Promise<Row[]> {
  return db().$queryRaw<Row[]>`
    SELECT "category", "source", "confidence", "cidr", "metadata"
    FROM "IpIntelligenceRecord"
    WHERE "network" >>= ${ip}::inet
      AND "category"::text = ANY(${categories.map(String)})
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    LIMIT 50`;
}

function toSignal(row: Row, group: string): Signal {
  return {
    code: `${row.category.toLowerCase()}_list_match`, category: row.category, source: row.source,
    confidence: row.confidence, weight: SIGNAL_WEIGHTS[row.category], group,
    detail: `${row.category} range ${row.cidr} listed by ${row.source}`, observedAt: new Date().toISOString(),
  };
}

// Known VPN / proxy / Tor / abuse ranges from the local feed database.
export const localIntelligenceProvider: IntelligenceProvider = {
  name: "local-intelligence", kind: "local",
  async check(input: CheckInput): Promise<ProviderResult> {
    const started = Date.now();
    try {
      const [fresh, rows] = await Promise.all([datasetFreshness(), matches(input.ip, ["VPN", "PROXY", "TOR", "MALICIOUS"])]);
      if (!fresh.version) return { ...failedResult(this.name, "local", "unconfigured", "No intelligence feed has imported successfully.", Date.now() - started, true), datasetVersion: undefined };
      // Each feed is its own correlation group; a Tor exit also present in a
      // VPN list is still two sources, but one list never counts twice.
      const signals = rows.map(r => toSignal(r, `local:${r.source}`));
      return { provider: this.name, kind: "local", status: fresh.stale ? "stale" : "ok", authoritative: true, signals, latencyMs: Date.now() - started, datasetVersion: fresh.version };
    } catch (error) {
      return failedResult(this.name, "local", "error", error instanceof Error ? error.name : "QueryFailed", Date.now() - started, true);
    }
  },
};

// Hosting / datacenter classification is a supporting signal only: cloud
// offices, universities and carriers produce the same evidence.
export const asnClassificationProvider: IntelligenceProvider = {
  name: "network-classification", kind: "asn",
  async check(input: CheckInput): Promise<ProviderResult> {
    const started = Date.now();
    try {
      const rows = await matches(input.ip, ["HOSTING"]);
      const signals = rows.map(r => {
        const asn = r.metadata && typeof r.metadata.asn === "string" ? ` (AS${r.metadata.asn}${typeof r.metadata.org === "string" ? ` ${r.metadata.org}` : ""})` : "";
        return { ...toSignal(r, "network-class"), code: "hosting_network", detail: `Hosting/datacenter range ${r.cidr}${asn} listed by ${r.source} — supporting signal only` };
      });
      return { provider: this.name, kind: "asn", status: "ok", authoritative: false, signals, latencyMs: Date.now() - started };
    } catch (error) {
      return failedResult(this.name, "asn", "error", error instanceof Error ? error.name : "QueryFailed", Date.now() - started, false);
    }
  },
};

// Repeated submissions from one network across businesses in 24h.
export const velocityProvider: IntelligenceProvider = {
  name: "submission-velocity", kind: "behavior",
  async check(input: CheckInput): Promise<ProviderResult> {
    const started = Date.now();
    try {
      const count = await db().review.count({ where: { ipHash: { in: input.ipHashes }, id: { not: input.reviewId }, createdAt: { gte: new Date(Date.now() - 86400_000) } } });
      const signals: Signal[] = count >= 3 ? [{
        code: "submission_velocity", category: "VELOCITY", source: "review-history", confidence: count >= 6 ? 100 : 50,
        weight: SIGNAL_WEIGHTS.VELOCITY, group: "behavior:velocity", detail: `${count} other reviews from this network in the last 24 hours`, observedAt: new Date().toISOString(),
      }] : [];
      return { provider: this.name, kind: "behavior", status: "ok", authoritative: false, signals, latencyMs: Date.now() - started };
    } catch (error) {
      return failedResult(this.name, "behavior", "error", error instanceof Error ? error.name : "QueryFailed", Date.now() - started, false);
    }
  },
};
