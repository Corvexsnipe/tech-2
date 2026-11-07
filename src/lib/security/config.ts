import { z } from "zod";
import { parseCidrList, type ParsedCidr } from "./cidr";

// Every ANTI_VPN_* variable is validated here once per process. Invalid
// values throw at first use (and at startup via instrumentation) rather than
// silently falling back to permissive behaviour.
const bool = z.enum(["true", "false", "1", "0", ""]).transform(v => v === "true" || v === "1");
const int = (min: number, max: number, fallback: number) => z.string().optional().transform(v => v === undefined || v === "" ? fallback : Number(v)).pipe(z.number().int().min(min).max(max));

const schema = z.object({
  ANTI_VPN_ENABLED: z.string().optional().default("true").pipe(bool),
  ANTI_VPN_MODE: z.enum(["local", "hybrid"]).default("hybrid"),
  ANTI_VPN_FAIL_CLOSED: z.string().optional().default("true").pipe(bool),
  ANTI_VPN_EXTERNAL_PROVIDER: z.enum(["none", "ipapi-is"]).default("none"),
  ANTI_VPN_EXTERNAL_API_KEY: z.string().optional().default(""),
  ANTI_VPN_REQUEST_TIMEOUT_MS: int(500, 30000, 3000),
  ANTI_VPN_CACHE_TTL_SECONDS: int(60, 30 * 86400, 3600),
  ANTI_VPN_MAX_DATA_AGE_HOURS: int(1, 24 * 30, 48),
  ANTI_VPN_LOW_RISK_MAX: int(0, 99, 29),
  ANTI_VPN_MEDIUM_RISK_MAX: int(1, 99, 69),
  ANTI_VPN_HIGH_RISK_MIN: int(1, 100, 70),
  ANTI_VPN_TRUSTED_PROXY_CIDRS: z.string().optional().default(""),
  ANTI_VPN_HMAC_SECRET: z.string().optional().default(""),
  ANTI_VPN_FEED_REFRESH_INTERVAL_HOURS: int(1, 24 * 7, 12),
  ANTI_VPN_IP_RETENTION_DAYS: int(1, 365, 30),
  ANTI_VPN_MAX_RETRIES: int(1, 20, 8),
  ANTI_VPN_INLINE_BUDGET_MS: int(0, 30000, 8000),
  ANTI_VPN_INPROCESS_SCHEDULER: z.string().optional().default("true").pipe(bool),
}).superRefine((v, ctx) => {
  if (!(v.ANTI_VPN_LOW_RISK_MAX < v.ANTI_VPN_MEDIUM_RISK_MAX && v.ANTI_VPN_MEDIUM_RISK_MAX < v.ANTI_VPN_HIGH_RISK_MIN))
    ctx.addIssue({ code: "custom", message: "Risk bands must satisfy LOW_MAX < MEDIUM_MAX < HIGH_MIN." });
  if (v.ANTI_VPN_HMAC_SECRET && v.ANTI_VPN_HMAC_SECRET.length < 32)
    ctx.addIssue({ code: "custom", message: "ANTI_VPN_HMAC_SECRET must be at least 32 characters." });
  if (v.ANTI_VPN_EXTERNAL_PROVIDER !== "none" && !v.ANTI_VPN_EXTERNAL_API_KEY)
    ctx.addIssue({ code: "custom", message: "ANTI_VPN_EXTERNAL_API_KEY is required when an external provider is selected." });
});

export interface SecurityConfig {
  enabled: boolean; mode: "local" | "hybrid"; failClosed: boolean;
  externalProvider: "none" | "ipapi-is"; externalApiKey: string;
  requestTimeoutMs: number; cacheTtlSeconds: number; maxDataAgeHours: number;
  lowRiskMax: number; mediumRiskMax: number; highRiskMin: number;
  trustedProxyCidrs: ParsedCidr[]; hmacSecret: string; hmacVersion: 1 | 2;
  feedRefreshIntervalHours: number; ipRetentionDays: number; maxRetries: number;
  inlineBudgetMs: number; inProcessScheduler: boolean;
  warnings: string[];
}

export function parseSecurityConfig(env: Record<string, string | undefined> = process.env): SecurityConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid ANTI_VPN configuration: ${parsed.error.issues.map(i => i.message).join("; ")}`);
  const v = parsed.data;
  const trustedProxyCidrs = parseCidrList(v.ANTI_VPN_TRUSTED_PROXY_CIDRS);
  const warnings: string[] = [];
  const hmacSecret = v.ANTI_VPN_HMAC_SECRET || env.APP_SECRET || "";
  if (!v.ANTI_VPN_HMAC_SECRET) warnings.push("ANTI_VPN_HMAC_SECRET is not set; IP hashes fall back to APP_SECRET (hash version 1).");
  if (v.ANTI_VPN_ENABLED && !hmacSecret) warnings.push("No HMAC secret available: duplicate-IP protection cannot run.");
  if (v.ANTI_VPN_ENABLED && !env.TRUST_PROXY && trustedProxyCidrs.length === 0) warnings.push("Neither TRUST_PROXY nor ANTI_VPN_TRUSTED_PROXY_CIDRS is set; client IPs cannot be resolved and every review will wait for manual review.");
  if ((env.TRUST_PROXY || "").split(",").map(h => h.trim().toLowerCase()).includes("cf-connecting-ip"))
    warnings.push("cf-connecting-ip is trusted only when CF-RAY and a matching X-Forwarded-For chain corroborate it; the origin must still accept Cloudflare traffic only (firewall rules or Tunnel).");
  if (v.ANTI_VPN_ENABLED && v.ANTI_VPN_MODE === "hybrid" && v.ANTI_VPN_EXTERNAL_PROVIDER === "none") warnings.push("Hybrid mode without an external provider runs local-only: new, residential, or rotating VPN endpoints absent from the feeds will not be detected.");
  if (!v.ANTI_VPN_FAIL_CLOSED) warnings.push("ANTI_VPN_FAIL_CLOSED=false: detection errors route reviews to manual review instead of retrying. Reviews are never auto-approved on error.");
  return {
    enabled: v.ANTI_VPN_ENABLED, mode: v.ANTI_VPN_MODE, failClosed: v.ANTI_VPN_FAIL_CLOSED,
    externalProvider: v.ANTI_VPN_EXTERNAL_PROVIDER, externalApiKey: v.ANTI_VPN_EXTERNAL_API_KEY,
    requestTimeoutMs: v.ANTI_VPN_REQUEST_TIMEOUT_MS, cacheTtlSeconds: v.ANTI_VPN_CACHE_TTL_SECONDS, maxDataAgeHours: v.ANTI_VPN_MAX_DATA_AGE_HOURS,
    lowRiskMax: v.ANTI_VPN_LOW_RISK_MAX, mediumRiskMax: v.ANTI_VPN_MEDIUM_RISK_MAX, highRiskMin: v.ANTI_VPN_HIGH_RISK_MIN,
    trustedProxyCidrs, hmacSecret, hmacVersion: v.ANTI_VPN_HMAC_SECRET ? 2 : 1,
    feedRefreshIntervalHours: v.ANTI_VPN_FEED_REFRESH_INTERVAL_HOURS, ipRetentionDays: v.ANTI_VPN_IP_RETENTION_DAYS, maxRetries: v.ANTI_VPN_MAX_RETRIES,
    inlineBudgetMs: v.ANTI_VPN_INLINE_BUDGET_MS, inProcessScheduler: v.ANTI_VPN_INPROCESS_SCHEDULER,
    warnings,
  };
}

let cached: SecurityConfig | null = null;
export function securityConfig() {
  return cached ??= parseSecurityConfig();
}
export function resetSecurityConfigForTests() { cached = null; }
