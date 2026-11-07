import { z } from "zod";
import { db } from "../../db";
import { securityConfig } from "../config";
import { securityLog } from "../audit";
import { failedResult, SIGNAL_WEIGHTS, type CheckInput, type IntelligenceProvider, type ProviderResult, type Signal } from "./types";

// Optional external IP intelligence. Server-side only; the request carries
// nothing but the IP. Results are cached by IP hash for ANTI_VPN_CACHE_TTL
// so historical re-evaluation never re-queries the vendor for a known IP.
// Adding a vendor = implementing `ExternalAdapter` and registering it below.

export interface ExternalVerdict { vpn: boolean; proxy: boolean; tor: boolean; hosting: boolean; abuser: boolean; asn?: string; org?: string }
export interface ExternalAdapter {
  name: string;
  fetchVerdict(ip: string, apiKey: string, signal: AbortSignal): Promise<ExternalVerdict>;
}

const ipapiSchema = z.object({
  is_vpn: z.boolean().optional(), is_proxy: z.boolean().optional(), is_tor: z.boolean().optional(),
  is_datacenter: z.boolean().optional(), is_abuser: z.boolean().optional(),
  asn: z.object({ asn: z.number().optional(), org: z.string().optional() }).partial().optional(),
}).passthrough();

const ipapiIs: ExternalAdapter = {
  name: "ipapi-is",
  async fetchVerdict(ip, apiKey, signal) {
    const url = new URL("https://api.ipapi.is/");
    url.searchParams.set("q", ip);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url, { signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (response.status === 429) throw Object.assign(new Error("RateLimited"), { name: "RateLimited", retryable: true });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { name: `Http${response.status}`, retryable: response.status >= 500 });
    const parsed = ipapiSchema.safeParse(await response.json());
    if (!parsed.success) throw Object.assign(new Error("InvalidResponse"), { name: "InvalidResponse", retryable: false });
    const v = parsed.data;
    return { vpn: !!v.is_vpn, proxy: !!v.is_proxy, tor: !!v.is_tor, hosting: !!v.is_datacenter, abuser: !!v.is_abuser, asn: v.asn?.asn?.toString(), org: v.asn?.org };
  },
};

export const EXTERNAL_ADAPTERS: Record<string, ExternalAdapter> = { "ipapi-is": ipapiIs };

// Bounded concurrency so one slow vendor cannot pile up connections.
const MAX_CONCURRENT = 4;
let active = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>(resolve => waiters.push(resolve));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function recordHealth(provider: string, ok: boolean, latencyMs: number, error?: string) {
  const now = new Date();
  await db().securityProviderHealth.upsert({
    where: { provider },
    create: { provider, status: ok ? "ok" : "failed", lastAttemptAt: now, lastSuccessAt: ok ? now : null, lastLatencyMs: latencyMs, consecutiveFailures: ok ? 0 : 1, errorSummary: error ?? null },
    update: { status: ok ? "ok" : "failed", lastAttemptAt: now, lastLatencyMs: latencyMs, errorSummary: error ?? null, ...(ok ? { lastSuccessAt: now, consecutiveFailures: 0 } : { consecutiveFailures: { increment: 1 } }) },
  }).catch(() => {});
}

function verdictSignals(v: ExternalVerdict, source: string): Signal[] {
  const at = new Date().toISOString();
  const group = `external:${source}`;
  const out: Signal[] = [];
  if (v.tor) out.push({ code: "external_tor", category: "TOR", source, confidence: 90, weight: SIGNAL_WEIGHTS.TOR, group, detail: `${source} classifies this IP as a Tor exit`, observedAt: at });
  if (v.vpn) out.push({ code: "external_vpn", category: "VPN", source, confidence: 85, weight: SIGNAL_WEIGHTS.VPN, group, detail: `${source} classifies this IP as a VPN endpoint`, observedAt: at });
  if (v.proxy) out.push({ code: "external_proxy", category: "PROXY", source, confidence: 85, weight: SIGNAL_WEIGHTS.PROXY, group, detail: `${source} classifies this IP as a proxy`, observedAt: at });
  if (v.hosting) out.push({ code: "external_hosting", category: "HOSTING", source, confidence: 80, weight: SIGNAL_WEIGHTS.HOSTING, group: "network-class", detail: `${source} classifies the network as hosting/datacenter${v.asn ? ` (AS${v.asn}${v.org ? ` ${v.org}` : ""})` : ""}`, observedAt: at });
  if (v.abuser) out.push({ code: "external_abuse", category: "MALICIOUS", source, confidence: 70, weight: SIGNAL_WEIGHTS.MALICIOUS, group: `${group}:abuse`, detail: `${source} reports abusive activity from this IP`, observedAt: at });
  return out;
}

export function externalProvider(adapterName?: string): IntelligenceProvider {
  const config = securityConfig();
  const adapter = EXTERNAL_ADAPTERS[adapterName ?? config.externalProvider];
  return {
    name: adapter ? `external:${adapter.name}` : "external", kind: "external",
    async check(input: CheckInput): Promise<ProviderResult> {
      const started = Date.now();
      if (!adapter) return failedResult("external", "external", "disabled", "No external provider configured.", 0, false);
      if (!config.externalApiKey) return failedResult(this.name, "external", "unconfigured", "API key missing.", 0, false);
      const cacheKey = input.ipHashes[0];
      const cached = await db().ipProviderCache.findUnique({ where: { provider_ipHash: { provider: adapter.name, ipHash: cacheKey } } }).catch(() => null);
      if (cached && cached.expiresAt > new Date()) {
        return { provider: this.name, kind: "external", status: "ok", authoritative: true, signals: verdictSignals(cached.result as unknown as ExternalVerdict, adapter.name), latencyMs: Date.now() - started, datasetVersion: `cache:${cached.fetchedAt.toISOString()}` };
      }
      let lastError = "Unknown";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const verdict = await withSlot(() => adapter.fetchVerdict(input.ip, config.externalApiKey, AbortSignal.timeout(config.requestTimeoutMs)));
          const latencyMs = Date.now() - started;
          await db().ipProviderCache.upsert({
            where: { provider_ipHash: { provider: adapter.name, ipHash: cacheKey } },
            create: { provider: adapter.name, ipHash: cacheKey, result: verdict as object, expiresAt: new Date(Date.now() + config.cacheTtlSeconds * 1000) },
            update: { result: verdict as object, fetchedAt: new Date(), expiresAt: new Date(Date.now() + config.cacheTtlSeconds * 1000) },
          }).catch(() => {});
          await recordHealth(adapter.name, true, latencyMs);
          return { provider: this.name, kind: "external", status: "ok", authoritative: true, signals: verdictSignals(verdict, adapter.name), latencyMs, datasetVersion: `live:${new Date().toISOString().slice(0, 10)}` };
        } catch (error) {
          const name = error instanceof Error ? error.name : "Error";
          lastError = name === "TimeoutError" || name === "AbortError" ? "Timeout" : name;
          const retryable = lastError === "Timeout" || (error as { retryable?: boolean }).retryable === true;
          securityLog("external_provider_attempt_failed", { provider: adapter.name, attempt, error: lastError, retryable });
          if (!retryable || attempt === 2) break;
          await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 200));
        }
      }
      const latencyMs = Date.now() - started;
      await recordHealth(adapter.name, false, latencyMs, lastError);
      return failedResult(this.name, "external", lastError === "Timeout" ? "timeout" : "error", lastError, latencyMs, true);
    },
  };
}
