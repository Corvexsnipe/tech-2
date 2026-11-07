// Compatibility surface over lib/security/ip-resolver. New code should import
// from "./security/ip-resolver" directly.
import { ipHashCurrent, normalizeIp, resolveClientIp } from "./security/ip-resolver";

export { normalizeIp };

// Returns the normalized client IP only when a trusted proxy configuration
// (TRUST_PROXY and/or ANTI_VPN_TRUSTED_PROXY_CIDRS) identifies it.
export function clientIp(headers: Headers): string | null {
  return resolveClientIp(headers).ip;
}

// Keyed HMAC of the normalized IP using the active key; never the raw IP.
export function ipHash(ip: string): string {
  return ipHashCurrent(ip).hash;
}
