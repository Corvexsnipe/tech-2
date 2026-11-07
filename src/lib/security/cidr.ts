// Dependency-free IPv4/IPv6 parsing and prefix matching. Used for validating
// feed entries, trusted-proxy ranges, and tests. Database lookups use
// PostgreSQL's native cidr operators instead of this module.

export interface ParsedIp { version: 4 | 6; value: bigint; text: string }
export interface ParsedCidr { version: 4 | 6; start: bigint; bits: number; text: string }

const V4_MAX = (1n << 32n) - 1n;
const V6_MAX = (1n << 128n) - 1n;

export function parseIp(raw: string): ParsedIp | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split(".").map(Number);
    if (parts.some(p => p > 255)) return null;
    const value = parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n);
    return { version: 4, value, text: parts.join(".") };
  }
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s) || s.length > 45) return null;
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1)
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".")) {
    const tail = parseIp(s.slice(lastColon + 1));
    if (!tail || tail.version !== 4) return null;
    const hi = Number(tail.value >> 16n), lo = Number(tail.value & 0xffffn);
    s = `${s.slice(0, lastColon)}:${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > (halves.length === 2 ? 7 : 8)) return null;
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (groups.some(g => g === "" || g.length > 4 || !/^[0-9a-f]+$/.test(g))) return null;
  let value = 0n;
  for (const g of groups) value = (value << 16n) + BigInt(parseInt(g, 16));
  // IPv4-mapped addresses normalize to their IPv4 form.
  if (value >> 32n === 0xffffn) {
    const v4 = value & V4_MAX;
    return { version: 4, value: v4, text: formatV4(v4) };
  }
  return { version: 6, value, text: formatV6(value) };
}

function formatV4(value: bigint) {
  return [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 0xffn)).join(".");
}

function formatV6(value: bigint) {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  // Longest zero run → "::" (RFC 5952)
  let bestStart = -1, bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map(g => g.toString(16));
  if (bestLen < 2) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":"), right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

export function parseCidr(raw: string): ParsedCidr | null {
  const s = raw.trim();
  const slash = s.lastIndexOf("/");
  const ipPart = slash === -1 ? s : s.slice(0, slash);
  const ip = parseIp(ipPart);
  if (!ip) return null;
  const maxBits = ip.version === 4 ? 32 : 128;
  let bits = maxBits;
  if (slash !== -1) {
    const b = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(b)) return null;
    bits = Number(b);
    if (bits > maxBits) return null;
  }
  const mask = bits === 0 ? 0n : ((ip.version === 4 ? V4_MAX : V6_MAX) >> BigInt(maxBits - bits)) << BigInt(maxBits - bits);
  const start = ip.value & mask;
  return { version: ip.version, start, bits, text: `${ip.version === 4 ? formatV4(start) : formatV6(start)}/${bits}` };
}

export function cidrContains(cidr: ParsedCidr, ip: ParsedIp) {
  if (cidr.version !== ip.version) return false;
  const maxBits = cidr.version === 4 ? 32 : 128;
  if (cidr.bits === 0) return true;
  return (ip.value >> BigInt(maxBits - cidr.bits)) === (cidr.start >> BigInt(maxBits - cidr.bits));
}

export function parseCidrList(raw: string | undefined): ParsedCidr[] {
  return (raw || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(s => {
    const c = parseCidr(s);
    if (!c) throw new Error(`Invalid CIDR: ${s}`);
    return c;
  });
}

// Ranges that can never be a real public client identity: private, loopback,
// link-local, CGNAT, multicast, reserved and documentation space. A resolved
// client IP inside any of these means a misconfigured proxy or a spoof — the
// engine fails closed to manual review instead of treating it as clean.
const NON_PUBLIC_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24",
  "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4",
].map(s => parseCidr(s)!);
const NON_PUBLIC_V6 = [
  "::/128", "::1/128", "100::/64", "2001:db8::/32", "fc00::/7", "fe80::/10", "ff00::/8",
].map(s => parseCidr(s)!);

export function isPublicIp(ip: ParsedIp): boolean {
  return !(ip.version === 4 ? NON_PUBLIC_V4 : NON_PUBLIC_V6).some(c => cidrContains(c, ip));
}
