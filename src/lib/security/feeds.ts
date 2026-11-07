import { Prisma, type IpCategory, type IpIntelligenceFeed } from "@prisma/client";
import { db } from "../db";
import { securityConfig } from "./config";
import { parseCidr } from "./cidr";
import { securityLog } from "./audit";

const MAX_FEED_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const INSERT_CHUNK = 2000;

export interface ParsedFeed { entries: { cidr: string; version: 4 | 6 }[]; rejected: number; total: number }

// Accepts one IP or CIDR per line; '#' and ';' start comments. Malformed
// entries are counted and dropped, duplicates collapse to one record.
export function parseFeedLines(text: string): ParsedFeed {
  const seen = new Set<string>();
  const entries: ParsedFeed["entries"] = [];
  let rejected = 0, total = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    total++;
    const cidr = parseCidr(line.split(/\s+/)[0]);
    if (!cidr) { rejected++; continue; }
    if (seen.has(cidr.text)) continue;
    seen.add(cidr.text);
    entries.push({ cidr: cidr.text, version: cidr.version });
  }
  return { entries, rejected, total };
}

export function assertFeedUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Feed URL is not valid."); }
  if (parsed.protocol !== "https:") throw new Error("Feed URLs must use https.");
  if (parsed.username || parsed.password) throw new Error("Feed URLs must not embed credentials.");
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|169\.254\.)/.test(parsed.hostname)) throw new Error("Feed URLs must point at a public host.");
  return parsed;
}

async function download(url: URL): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow", headers: { accept: "text/plain, */*" }, cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: `HTTP_${response.status}` });
  if (Number(response.headers.get("content-length")) > MAX_FEED_BYTES) throw Object.assign(new Error("Feed too large"), { code: "TOO_LARGE" });
  if (!response.body) throw Object.assign(new Error("Empty body"), { code: "EMPTY" });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_FEED_BYTES) { await reader.cancel(); throw Object.assign(new Error("Feed too large"), { code: "TOO_LARGE" }); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Replaces one source's records atomically: the old set is deleted and the
// new set inserted inside a single transaction, so a failed import (network,
// parse, or constraint error) leaves the previous valid dataset untouched.
export async function importEntries(source: string, category: IpCategory, confidence: number, entries: ParsedFeed["entries"]) {
  const config = securityConfig();
  const expiresAt = new Date(Date.now() + Math.max(config.maxDataAgeHours, 2 * config.feedRefreshIntervalHours) * 3600_000);
  await db().$transaction(async tx => {
    await tx.ipIntelligenceRecord.deleteMany({ where: { source } });
    for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
      const chunk = entries.slice(i, i + INSERT_CHUNK);
      const ids = chunk.map(() => `ipr_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`);
      await tx.$executeRaw`
        INSERT INTO "IpIntelligenceRecord" ("id", "cidr", "network", "ipVersion", "category", "source", "confidence", "firstSeenAt", "lastUpdatedAt", "expiresAt")
        SELECT id, cidr, cidr::cidr, version, ${category}::"IpCategory", ${source}, ${confidence}, NOW(), NOW(), ${expiresAt}
        FROM unnest(${ids}::text[], ${chunk.map(e => e.cidr)}::text[], ${chunk.map(e => e.version)}::int[]) AS t(id, cidr, version)
        ON CONFLICT ("source", "cidr", "category") DO UPDATE SET "lastUpdatedAt" = NOW(), "expiresAt" = EXCLUDED."expiresAt", "confidence" = EXCLUDED."confidence"`;
    }
  }, { timeout: 180_000, maxWait: 15_000 });
}

export async function refreshFeed(feed: IpIntelligenceFeed): Promise<{ ok: boolean; imported: number; rejected: number; error?: string }> {
  const started = new Date();
  await db().ipIntelligenceFeed.update({ where: { id: feed.id }, data: { lastAttemptAt: started } });
  try {
    const url = assertFeedUrl(feed.url);
    const text = await download(url);
    const parsed = parseFeedLines(text);
    if (parsed.entries.length === 0) throw Object.assign(new Error("No valid entries"), { code: "NO_ENTRIES" });
    if (parsed.rejected > parsed.total / 2) throw Object.assign(new Error("Majority of entries malformed"), { code: "MALFORMED_FEED" });
    await importEntries(feed.source, feed.category, feed.confidence, parsed.entries);
    await db().ipIntelligenceFeed.update({ where: { id: feed.id }, data: { status: "ok", lastSuccessAt: new Date(), recordsImported: parsed.entries.length, errorCode: null, errorSummary: null } });
    securityLog("feed_refreshed", { source: feed.source, imported: parsed.entries.length, rejected: parsed.rejected });
    return { ok: true, imported: parsed.entries.length, rejected: parsed.rejected };
  } catch (error) {
    const code = (error as { code?: string }).code || (error instanceof Error ? error.name : "ERROR");
    const summary = error instanceof Error ? error.message.slice(0, 200) : "Import failed";
    await db().ipIntelligenceFeed.update({ where: { id: feed.id }, data: { status: "failed", errorCode: code, errorSummary: summary } });
    securityLog("feed_failed", { source: feed.source, code });
    return { ok: false, imported: 0, rejected: 0, error: code };
  }
}

export async function feedsDue(force = false) {
  const intervalMs = securityConfig().feedRefreshIntervalHours * 3600_000;
  const feeds = await db().ipIntelligenceFeed.findMany({ where: { enabled: true }, orderBy: { source: "asc" } });
  return force ? feeds : feeds.filter(f => !f.lastSuccessAt || f.lastSuccessAt.getTime() < Date.now() - intervalMs);
}

export async function feedHealth() {
  const config = securityConfig();
  const feeds = await db().ipIntelligenceFeed.findMany({ orderBy: { source: "asc" } });
  const counts = await db().ipIntelligenceRecord.groupBy({ by: ["source"], _count: { _all: true }, where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  const bySource = new Map(counts.map(c => [c.source, c._count._all]));
  return feeds.map(f => ({
    ...f, activeRecords: bySource.get(f.source) ?? 0,
    stale: !f.lastSuccessAt || f.lastSuccessAt.getTime() < Date.now() - config.maxDataAgeHours * 3600_000,
  }));
}

export const FEED_CATEGORIES: IpCategory[] = ["VPN", "PROXY", "TOR", "HOSTING", "MALICIOUS"];
export type FeedInput = Prisma.IpIntelligenceFeedCreateInput;
