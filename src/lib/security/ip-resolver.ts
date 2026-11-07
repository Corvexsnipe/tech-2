import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { cidrContains, parseIp, type ParsedCidr } from "./cidr";
import { securityConfig } from "./config";

// Resolves the public client IP from a request. Trust is explicit:
//  - TRUST_PROXY names the forwarding headers a front proxy is known to set.
//  - ANTI_VPN_TRUSTED_PROXY_CIDRS lists proxy/load-balancer ranges; when set,
//    X-Forwarded-For is walked right-to-left and every trusted hop is skipped,
//    so a client cannot prepend a fake address. Without it, the left-most
//    entry is used (correct only when the proxy overwrites the header).
// The application layer cannot see the TCP peer address, so the front proxy
// must reliably overwrite or append these headers (see IMPLEMENTATION.md).
// Resolves the client from an X-Forwarded-For style hop list. With trusted
// proxy CIDRs configured, hops are walked right-to-left skipping trusted
// ranges so a client cannot prepend a fake address; without them the
// left-most entry is used (correct only when the proxy overwrites it).
function xffClientIp(hops: string[], trusted: ParsedCidr[]): { ip: string | null; reason: string } {
  if (trusted.length === 0) {
    const ip = parseIp(hops[0]);
    return ip ? { ip: ip.text, reason: "XFF_LEFTMOST" } : { ip: null, reason: "MALFORMED_HEADER" };
  }
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = parseIp(hops[i]);
    if (!ip) return { ip: null, reason: "MALFORMED_HEADER" };
    if (trusted.some(c => cidrContains(c, ip))) continue;
    return { ip: ip.text, reason: "XFF_TRUSTED_CHAIN" };
  }
  return { ip: null, reason: "ONLY_TRUSTED_HOPS" };
}

// CF-Connecting-IP is honoured only when the request plausibly arrived via
// Cloudflare: Cloudflare always appends the client address to
// X-Forwarded-For and sets CF-RAY, so a forged CF header on direct traffic
// disagrees or is alone. The TCP peer is invisible at the application layer,
// so this is corroboration rather than proof — the origin must still accept
// only Cloudflare traffic (firewall to the published ranges, or Tunnel).
function verifyCloudflare(headers: Headers, clientIp: string, trusted: ParsedCidr[]): { ip: null; reason: string } | null {
  const xff = headers.get("x-forwarded-for");
  const hops = xff ? xff.split(",").map(s => s.trim()).filter(Boolean) : [];
  if (!hops.length || !headers.get("cf-ray")) return { ip: null, reason: "UNTRUSTED_CLOUDFLARE_HEADER" };
  const resolved = xffClientIp(hops, trusted);
  if (!resolved.ip || resolved.ip !== clientIp) return { ip: null, reason: "UNTRUSTED_CLOUDFLARE_HEADER" };
  return null;
}

export function resolveClientIp(headers: Headers): { ip: string | null; reason: string } {
  const trustedHeaders = (process.env.TRUST_PROXY || "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
  const { trustedProxyCidrs } = securityConfig();
  if (trustedHeaders.length === 0 && trustedProxyCidrs.length === 0) return { ip: null, reason: "NO_TRUSTED_PROXY" };
  const headerNames = trustedHeaders.length ? trustedHeaders : ["x-forwarded-for"];
  for (const name of headerNames) {
    const value = headers.get(name);
    if (!value) continue;
    const hops = value.split(",").map(s => s.trim()).filter(Boolean);
    if (hops.length === 0) continue;
    if (name === "cf-connecting-ip") {
      const ip = parseIp(hops[0]);
      if (!ip) return { ip: null, reason: "MALFORMED_HEADER" };
      const rejected = verifyCloudflare(headers, ip.text, trustedProxyCidrs);
      if (rejected) return rejected;
      return { ip: ip.text, reason: `HEADER:${name}` };
    }
    if (name !== "x-forwarded-for" && name !== "forwarded") {
      const ip = parseIp(hops[0]);
      if (ip) return { ip: ip.text, reason: `HEADER:${name}` };
      return { ip: null, reason: "MALFORMED_HEADER" };
    }
    return xffClientIp(hops, trustedProxyCidrs);
  }
  return { ip: null, reason: "HEADER_MISSING" };
}

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // "1.2.3.4:5678" (IPv4 with port) and "[::1]:443" (bracketed IPv6 with
  // port) — strip the port before parsing.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.split(":")[0];
  else if (s.startsWith("[")) { const end = s.indexOf("]"); if (end !== -1 && (end === s.length - 1 || s[end + 1] === ":")) s = s.slice(0, end + 1); }
  return parseIp(s)?.text ?? null;
}

// Keyed hashes. Version 1 = APP_SECRET (legacy rows); version 2 = dedicated
// ANTI_VPN_HMAC_SECRET. ipHashes() returns every key's hash so duplicate
// checks still match rows written before a key rotation.
function hmac(ip: string, key: string) {
  return createHmac("sha256", key).update(`review-ip:${ip}`).digest("hex");
}
export function ipHashCurrent(ip: string): { hash: string; version: 1 | 2 } {
  const config = securityConfig();
  const key = config.hmacSecret || "dev-only-secret";
  return { hash: hmac(ip, key), version: config.hmacVersion };
}
export function ipHashes(ip: string): string[] {
  const current = ipHashCurrent(ip);
  const legacy = process.env.APP_SECRET ? hmac(ip, process.env.APP_SECRET) : null;
  return legacy && legacy !== current.hash ? [current.hash, legacy] : [current.hash];
}

// Short-lived encrypted copy of the IP so a pending check can be retried and
// a cleared review re-evaluated after feed updates. AES-256-GCM, key derived
// from the HMAC secret; nulled by the cleanup job after the retention window.
function encryptionKey() {
  return createHash("sha256").update(`anti-vpn-ip-at-rest:${securityConfig().hmacSecret || "dev-only-secret"}`).digest();
}
export function encryptIp(ip: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(ip, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}
export function decryptIp(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const [version, iv, body, tag] = blob.split(".");
  if (version !== "v1" || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}
