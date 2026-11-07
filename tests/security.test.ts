import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cidrContains, isPublicIp, parseCidr, parseCidrList, parseIp } from "../src/lib/security/cidr";
import { parseSecurityConfig, resetSecurityConfigForTests } from "../src/lib/security/config";
import { decryptIp, encryptIp, ipHashCurrent, ipHashes, normalizeIp, resolveClientIp } from "../src/lib/security/ip-resolver";
import { bandFor, decide, scoreSignals, SUPPORTING_ONLY_CAP } from "../src/lib/security/risk-scoring";
import { assertFeedUrl, parseFeedLines } from "../src/lib/security/feeds";
import { redact } from "../src/lib/security/audit";
import { isEligibleReview } from "../src/lib/security/review-eligibility";
import { SIGNAL_WEIGHTS, type ProviderResult, type Signal } from "../src/lib/security/providers/types";

const BANDS = { lowRiskMax: 29, mediumRiskMax: 69, highRiskMin: 70 };
const at = new Date().toISOString();
const sig = (category: Signal["category"], source: string, confidence: number, group = `local:${source}`): Signal =>
  ({ code: `${category.toLowerCase()}_list_match`, category, source, confidence, weight: SIGNAL_WEIGHTS[category], group, detail: `${category} from ${source}`, observedAt: at });
const local = (signals: Signal[], status: ProviderResult["status"] = "ok"): ProviderResult =>
  ({ provider: "local-intelligence", kind: "local", status, authoritative: true, signals, latencyMs: 1, datasetVersion: "2026-10-20T00:00:00.000Z" });
const asn = (signals: Signal[]): ProviderResult => ({ provider: "network-classification", kind: "asn", status: "ok", authoritative: false, signals, latencyMs: 1 });
const velocity = (signals: Signal[]): ProviderResult => ({ provider: "submission-velocity", kind: "behavior", status: "ok", authoritative: false, signals, latencyMs: 1 });
const external = (signals: Signal[], status: ProviderResult["status"] = "ok"): ProviderResult => ({ provider: "external:test", kind: "external", status, authoritative: true, signals, latencyMs: 5 });

beforeEach(() => { resetSecurityConfigForTests(); delete process.env.ANTI_VPN_TRUSTED_PROXY_CIDRS; delete process.env.TRUST_PROXY; delete process.env.ANTI_VPN_HMAC_SECRET; });

describe("CIDR parsing and matching", () => {
  it("parses and normalizes IPv4, IPv6, mapped and bracketed forms", () => {
    assert.equal(parseIp("192.0.2.1")?.text, "192.0.2.1");
    assert.equal(parseIp("::ffff:192.0.2.1")?.text, "192.0.2.1");
    assert.equal(parseIp("[2001:db8::1]")?.text, "2001:db8::1");
    assert.equal(parseIp("2001:0DB8:0000:0000:0000:0000:0000:0001")?.text, "2001:db8::1");
    assert.equal(parseIp("2001:db8:0:0:1:0:0:1")?.text, "2001:db8::1:0:0:1");
    for (const bad of ["", "999.1.1.1", "1.2.3", "2001:db8::1::2", "not-an-ip", "2001:db8:zz::1"]) assert.equal(parseIp(bad), null, bad);
  });
  it("matches prefixes correctly across both families", () => {
    const v4 = parseCidr("198.51.100.0/24")!, v6 = parseCidr("2001:db8::/32")!, host = parseCidr("203.0.113.7")!;
    assert.equal(v4.text, "198.51.100.0/24");
    assert.equal(parseCidr("198.51.100.77/24")!.text, "198.51.100.0/24");
    assert.equal(host.bits, 32);
    assert.ok(cidrContains(v4, parseIp("198.51.100.200")!));
    assert.ok(!cidrContains(v4, parseIp("198.51.101.1")!));
    assert.ok(cidrContains(v6, parseIp("2001:db8:ffff::1")!));
    assert.ok(!cidrContains(v6, parseIp("2001:db9::1")!));
    assert.ok(!cidrContains(v4, parseIp("::ffff:198.51.101.1")!));
    assert.ok(cidrContains(parseCidr("0.0.0.0/0")!, parseIp("8.8.8.8")!));
    for (const bad of ["10.0.0.0/33", "2001:db8::/129", "10.0.0.0/x"]) assert.equal(parseCidr(bad), null, bad);
    assert.throws(() => parseCidrList("10.0.0.0/8, garbage"));
  });
});

describe("configuration validation", () => {
  it("applies documented defaults and rejects inconsistent bands or missing keys", () => {
    const c = parseSecurityConfig({ APP_SECRET: "x".repeat(40) });
    assert.equal(c.enabled, true); assert.equal(c.mode, "hybrid"); assert.equal(c.failClosed, true);
    assert.deepEqual([c.lowRiskMax, c.mediumRiskMax, c.highRiskMin], [29, 69, 70]);
    assert.equal(c.hmacVersion, 1);
    assert.ok(c.warnings.some(w => w.includes("ANTI_VPN_HMAC_SECRET")));
    assert.throws(() => parseSecurityConfig({ ANTI_VPN_LOW_RISK_MAX: "80", ANTI_VPN_HIGH_RISK_MIN: "70" }), /bands/);
    assert.throws(() => parseSecurityConfig({ ANTI_VPN_EXTERNAL_PROVIDER: "ipapi-is" }), /API_KEY/);
    assert.throws(() => parseSecurityConfig({ ANTI_VPN_HMAC_SECRET: "short" }), /32/);
    assert.throws(() => parseSecurityConfig({ ANTI_VPN_TRUSTED_PROXY_CIDRS: "nope" }), /Invalid CIDR/);
    assert.throws(() => parseSecurityConfig({ ANTI_VPN_REQUEST_TIMEOUT_MS: "1" }));
    assert.equal(parseSecurityConfig({ ANTI_VPN_HMAC_SECRET: "y".repeat(32) }).hmacVersion, 2);
  });
});

describe("client IP resolution", () => {
  it("trusts nothing without proxy configuration", () => {
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "203.0.113.5" })).ip, null);
  });
  it("uses the left-most hop under header-name trust and rejects malformed values", () => {
    process.env.TRUST_PROXY = "x-forwarded-for";
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })).ip, "203.0.113.5");
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "<script>, 10.0.0.1" })).ip, null);
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "::ffff:203.0.113.9" })).ip, "203.0.113.9");
  });
  it("walks the chain from the proxy side when trusted CIDRs are configured, defeating prepended spoofs", () => {
    process.env.ANTI_VPN_TRUSTED_PROXY_CIDRS = "10.0.0.0/8, 2001:db8::/32";
    // Attacker sends "1.1.1.1"; proxy appends the real peer 203.0.113.5; LB appends itself.
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.5, 10.0.0.2" })).ip, "203.0.113.5");
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "10.0.0.3, 10.0.0.2" })).ip, null);
    assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "2001:db8::1:2:3, 10.0.0.2" })).reason, "ONLY_TRUSTED_HOPS");
  });
  it("trusts cf-connecting-ip only when Cloudflare headers corroborate it", () => {
    process.env.TRUST_PROXY = "cf-connecting-ip";
    const base = { "cf-connecting-ip": "203.0.113.9" };
    // A bare header on direct traffic is never trusted: Cloudflare always
    // appends the client to X-Forwarded-For and sets CF-RAY.
    assert.equal(resolveClientIp(new Headers(base)).reason, "UNTRUSTED_CLOUDFLARE_HEADER");
    assert.equal(resolveClientIp(new Headers({ ...base, "x-forwarded-for": "203.0.113.9" })).reason, "UNTRUSTED_CLOUDFLARE_HEADER");
    assert.equal(resolveClientIp(new Headers({ ...base, "cf-ray": "9a1b-IAD" })).reason, "UNTRUSTED_CLOUDFLARE_HEADER");
    // A disagreeing X-Forwarded-For chain is rejected.
    assert.equal(resolveClientIp(new Headers({ ...base, "cf-ray": "9a1b-IAD", "x-forwarded-for": "198.51.100.3" })).reason, "UNTRUSTED_CLOUDFLARE_HEADER");
    // Corroborated chains are trusted, IPv4 and IPv6.
    assert.equal(resolveClientIp(new Headers({ ...base, "cf-ray": "9a1b-IAD", "x-forwarded-for": "203.0.113.9" })).ip, "203.0.113.9");
    assert.equal(resolveClientIp(new Headers({ "cf-connecting-ip": "2001:db8::99", "cf-ray": "9a1b-IAD", "x-forwarded-for": "2001:db8::99" })).ip, "2001:db8::99");
  });
  it("cf-connecting-ip corroborates through a trusted load-balancer hop", () => {
    process.env.TRUST_PROXY = "cf-connecting-ip";
    process.env.ANTI_VPN_TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    // A trusted upstream hop sits between Cloudflare and the origin: the
    // CIDR walk skips it and still lands on the same client.
    assert.equal(resolveClientIp(new Headers({ "cf-connecting-ip": "203.0.113.9", "cf-ray": "9a1b-IAD", "x-forwarded-for": "203.0.113.9, 10.0.0.9" })).ip, "203.0.113.9");
    // Forged: the CF header claims a client the chain does not support.
    assert.equal(resolveClientIp(new Headers({ "cf-connecting-ip": "203.0.113.9", "cf-ray": "9a1b-IAD", "x-forwarded-for": "8.8.8.8, 10.0.0.9" })).ip, null);
  });
  it("normalizes ports and hashes deterministically with every key version", () => {
    process.env.APP_SECRET = "a".repeat(40);
    assert.equal(normalizeIp("203.0.113.5:4433"), "203.0.113.5");
    assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
    const h1 = ipHashCurrent("203.0.113.5");
    assert.equal(h1.version, 1);
    assert.equal(h1.hash, ipHashCurrent("::ffff:203.0.113.5".replace("::ffff:", "")).hash);
    assert.notEqual(h1.hash, ipHashCurrent("203.0.113.6").hash);
    assert.ok(!h1.hash.includes("203.0.113"));
    resetSecurityConfigForTests();
    process.env.ANTI_VPN_HMAC_SECRET = "b".repeat(40);
    const rotated = ipHashes("203.0.113.5");
    assert.equal(rotated.length, 2, "current and legacy hash both returned after rotation");
    assert.equal(rotated[1], h1.hash);
    assert.equal(ipHashCurrent("203.0.113.5").version, 2);
  });
  it("recognizes only globally routable addresses as public client identities", () => {
    for (const priv of ["10.0.0.1", "172.16.5.5", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.9", "192.0.2.1", "198.51.100.9", "203.0.113.9", "224.0.0.1", "240.0.0.1", "0.1.2.3", "::1", "::", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "100::1"])
      assert.equal(isPublicIp(parseIp(priv)!), false, priv);
    for (const pub of ["8.8.8.8", "1.1.1.1", "203.0.114.1", "198.51.101.1", "2606:4700:4700::1111"])
      assert.equal(isPublicIp(parseIp(pub)!), true, pub);
    // IPv4-mapped private addresses stay non-public.
    assert.equal(isPublicIp(parseIp("::ffff:10.0.0.1")!), false);
    assert.equal(isPublicIp(parseIp("::ffff:8.8.8.8")!), true);
  });
  it("encrypts the IP at rest and round-trips; tampered blobs decrypt to null", () => {
    process.env.APP_SECRET = "a".repeat(40);
    const blob = encryptIp("203.0.113.5");
    assert.ok(!blob.includes("203.0.113"));
    assert.equal(decryptIp(blob), "203.0.113.5");
    assert.equal(decryptIp(blob.slice(0, -4) + "AAAA"), null);
    assert.equal(decryptIp("garbage"), null);
  });
});

describe("risk scoring", () => {
  it("known VPN endpoint → VPN_DETECTED / FLAGGED_VPN", () => {
    const results = [local([sig("VPN", "x4bnet-vpn-ipv4", 100)]), asn([]), velocity([])];
    const scored = scoreSignals(results);
    assert.equal(scored.score, 70);
    const d = decide(results, scored, BANDS, true);
    assert.equal(d.classification, "VPN_DETECTED"); assert.equal(d.state, "FLAGGED_VPN");
  });
  it("known proxy and Tor endpoints classify by category", () => {
    const proxy = [local([sig("PROXY", "proxy-list", 100)])];
    assert.equal(decide(proxy, scoreSignals(proxy), BANDS, true).state, "FLAGGED_PROXY");
    const tor = [local([sig("TOR", "torproject-exit-list", 95)])];
    const d = decide(tor, scoreSignals(tor), BANDS, true);
    assert.equal(d.classification, "TOR_DETECTED"); assert.equal(d.state, "FLAGGED_TOR");
  });
  it("hosting ASN alone is capped and never flags as VPN", () => {
    const results = [local([]), asn([sig("HOSTING", "x4bnet-datacenter-ipv4", 100, "network-class")]), velocity([])];
    const scored = scoreSignals(results);
    assert.equal(scored.score, 25); assert.equal(scored.endpointEvidence, false);
    assert.equal(decide(results, scored, BANDS, true).state, "SECURITY_CLEARED");
    // Even hosting + heavy velocity + abuse list cannot exceed the supporting cap.
    const heavy = [local([sig("MALICIOUS", "abuse-list", 100)]), asn([sig("HOSTING", "dc", 100, "network-class")]), velocity([sig("VELOCITY", "review-history", 100, "behavior:velocity")])];
    const s2 = scoreSignals(heavy);
    assert.ok(s2.score <= SUPPORTING_ONLY_CAP);
    const d2 = decide(heavy, s2, BANDS, true);
    assert.equal(d2.classification, "SUSPICIOUS_NETWORK"); assert.equal(d2.state, "MANUAL_REVIEW_REQUIRED");
  });
  it("collapses correlated signals from one dataset and compounds independent ones", () => {
    const sameGroup = scoreSignals([local([sig("VPN", "feed-a", 100), sig("VPN", "feed-a", 60)])]);
    assert.equal(sameGroup.score, 70, "two hits from one list count once");
    const independent = scoreSignals([local([sig("VPN", "feed-a", 100)]), external([sig("VPN", "vendor", 85, "external:vendor")])]);
    assert.ok(independent.score > 70 && independent.score <= 100, `noisy-or: ${independent.score}`);
    assert.equal(independent.score, Math.round((1 - 0.3 * (1 - 0.595)) * 100));
  });
  it("weak single-source evidence lands in manual review, not auto-rejection", () => {
    const results = [local([sig("VPN", "x4bnet-vpn-ipv4", 60)])];
    const scored = scoreSignals(results);
    assert.equal(bandFor(scored.score, BANDS), "medium");
    const d = decide(results, scored, BANDS, true);
    assert.equal(d.state, "MANUAL_REVIEW_REQUIRED"); assert.equal(d.reasonCode, "WEAK_ENDPOINT_EVIDENCE");
  });
  it("clean IP in a fresh dataset and an unknown IP both clear", () => {
    const d = decide([local([]), asn([]), velocity([])], scoreSignals([local([])]), BANDS, true);
    assert.equal(d.classification, "CLEAN"); assert.equal(d.state, "SECURITY_CLEARED");
  });
  it("never clears when no authoritative provider succeeded (timeout, invalid response, DB error)", () => {
    for (const status of ["timeout", "error", "unconfigured"] as const) {
      const results = [local([], "error"), external([], status), asn([]), velocity([])];
      const d = decide(results, scoreSignals(results), BANDS, true);
      assert.equal(d.classification, "DETECTION_ERROR", status); assert.equal(d.state, "SECURITY_CHECK_FAILED", status);
    }
    const open = decide([local([], "error")], scoreSignals([]), BANDS, false);
    assert.equal(open.state, "MANUAL_REVIEW_REQUIRED", "fail-open still never clears");
  });
  it("stale local data without an external verdict is DATA_STALE, but a stale hit still flags", () => {
    const stale = [local([], "stale"), asn([]), velocity([])];
    const d = decide(stale, scoreSignals(stale), BANDS, true);
    assert.equal(d.classification, "DATA_STALE"); assert.equal(d.state, "SECURITY_CHECK_FAILED");
    const staleHit = [local([sig("TOR", "torproject-exit-list", 100)], "stale")];
    const s = scoreSignals(staleHit);
    assert.equal(s.score, 56, "stale evidence is discounted");
    assert.equal(decide(staleHit, s, BANDS, true).state, "MANUAL_REVIEW_REQUIRED");
    const withExternal = [local([], "stale"), external([])];
    assert.equal(decide(withExternal, scoreSignals(withExternal), BANDS, true).state, "SECURITY_CLEARED", "external verdict is authoritative when local is stale");
  });
});

describe("feed parsing and URL safety", () => {
  it("accepts IPs and CIDRs, strips comments, dedupes and counts malformed lines", () => {
    const parsed = parseFeedLines("# header\n192.0.2.0/24\n192.0.2.0/24 ; dup\n198.51.100.7\n2001:db8::/32\nbad.entry\n300.1.1.1\n\n203.0.113.5:443\n");
    assert.deepEqual(parsed.entries.map(e => e.cidr), ["192.0.2.0/24", "198.51.100.7/32", "2001:db8::/32"]);
    assert.equal(parsed.rejected, 3); assert.equal(parsed.total, 7);
  });
  it("rejects non-https, credentialed and private feed URLs", () => {
    assert.ok(assertFeedUrl("https://example.org/list.txt"));
    for (const bad of ["http://example.org/x", "https://user:pw@example.org/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://localhost/x", "https://169.254.169.254/latest", "ftp://x"]) assert.throws(() => assertFeedUrl(bad), bad);
  });
});

describe("privacy controls", () => {
  it("redacts IPs and secret-like keys from log fields while keeping counters", () => {
    const out = redact({ ip: "203.0.113.5", apiKey: "k", detail: "seen 203.0.113.5 and 2001:db8::1 twice", ipsPurged: 3, nested: { password: "p", count: 2 } });
    assert.equal(out.ip, "[redacted]"); assert.equal(out.apiKey, "[redacted]");
    assert.equal(out.detail, "seen [ip] and [ip] twice");
    assert.equal(out.ipsPurged, 3); assert.equal(out.nested.password, "[redacted]"); assert.equal(out.nested.count, 2);
  });
  it("eligibility requires both publication and a cleared security state", () => {
    assert.ok(isEligibleReview({ status: "PUBLISHED", securityState: "SECURITY_CLEARED" }));
    assert.ok(!isEligibleReview({ status: "PUBLISHED", securityState: "FLAGGED_VPN" }));
    assert.ok(!isEligibleReview({ status: "PENDING", securityState: "SECURITY_CLEARED" }));
    assert.ok(!isEligibleReview({ status: "PENDING", securityState: "PENDING_SECURITY_CHECK" }));
  });
});
