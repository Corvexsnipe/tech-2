import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { GRADES, POINTS, activeReviewKey, gradeFor, reputation, reviewScore } from "../src/lib/grades";
import { canReadEvidence, sanitizeImage, MAX_UPLOAD } from "../src/lib/uploads";
import { assertSameOrigin, digest, passwordHash, passwordMatches } from "../src/lib/security";
import { businessQr } from "../src/lib/qr";
import { canonicalProfile } from "../src/lib/db";
import { clientIp, ipHash, normalizeIp } from "../src/lib/ip";
import { domainInput, limitedBody, normalizeDomain, password, reviewInput, website } from "../src/lib/validation";

describe("exact grading policy", () => {
  it("has only the five supported grades and the exact point mapping", () => {
    assert.deepEqual(GRADES, ["A+", "A", "B", "C", "D"]);
    assert.deepEqual(POINTS, { "A+": 100, A: 80, B: 70, C: 50, D: 15 });
  });
  it("computes every category combination and the required example", () => {
    for (const service of GRADES) {
      assert.equal(reviewScore(service), POINTS[service]);
      assert.equal(reviewScore(service, null), POINTS[service]);
      for (const support of GRADES) assert.equal(reviewScore(service, support), (POINTS[service] + POINTS[support]) / 2);
    }
    assert.equal(reviewScore("A+", "B"), 85);
    assert.equal(gradeFor(85), "A");
  });
  it("handles every threshold without rounding into a higher grade", () => {
    for (const [score, expected] of [[100, "A+"], [90, "A+"], [89.999, "A"], [80, "A"], [79.999, "B"], [70, "B"], [69.999, "C"], [50, "C"], [49.999, "D"], [0, "D"]] as const) assert.equal(gradeFor(score), expected);
    for (const score of [-1, 101, NaN, Infinity]) assert.throws(() => gradeFor(score));
  });
  it("keeps the business grade provisional until the configured minimum", () => {
    const first = { score: 85, serviceGrade: "A_PLUS", supportGrade: "B" };
    const serviceOnly = { score: 15, serviceGrade: "D", supportGrade: null };
    assert.equal(reputation([]).score, null);
    assert.equal(reputation([first, serviceOnly]).grade, null);
    const aggregate = reputation([first, serviceOnly, first]);
    assert.equal(aggregate.score, 185 / 3);
    assert.equal(aggregate.grade, "C");
    assert.equal(aggregate.support, 70);
    assert.equal(reputation([first, serviceOnly, first], 4).grade, null);
  });
  it("creates collision-free active review identifiers", () => {
    assert.notEqual(activeReviewKey("a:b", "c"), activeReviewKey("a", "b:c"));
    assert.equal(activeReviewKey("customer", "business"), activeReviewKey("customer", "business"));
  });
});

describe("client IP handling", () => {
  it("normalizes IPv4, IPv6 and mapped forms, and rejects junk", () => {
    assert.equal(normalizeIp(" 203.0.113.7 "), "203.0.113.7");
    assert.equal(normalizeIp("203.0.113.7:8080"), "203.0.113.7");
    assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.equal(normalizeIp("::ffff:192.0.2.1"), "192.0.2.1");
    assert.equal(normalizeIp("not-an-ip"), null);
    assert.equal(normalizeIp(""), null);
    assert.equal(normalizeIp(null), null);
  });
  it("never trusts forwarding headers without TRUST_PROXY", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(headers), null);
    process.env.TRUST_PROXY = "x-forwarded-for";
    assert.equal(clientIp(headers), "203.0.113.7");
    assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.1" })), null);
    delete process.env.TRUST_PROXY;
  });
  it("hashes IPs with a keyed, deterministic HMAC that never stores the raw IP", () => {
    process.env.APP_SECRET = "test-secret-for-ip-hashing-only";
    assert.equal(ipHash("192.0.2.1"), ipHash("192.0.2.1"));
    assert.notEqual(ipHash("192.0.2.1"), ipHash("192.0.2.2"));
    assert.equal(/^[a-f0-9]{64}$/.test(ipHash("192.0.2.1")), true);
    assert.equal(ipHash("192.0.2.1").includes("192"), false);
  });
});

describe("server input and authorization safeguards", () => {
  it("rejects unsupported grades and duplicate attachments", () => {
    const input = { businessId: "business", headline: "A clear headline", body: "This is a sufficiently detailed description of my experience.", serviceGrade: "A" };
    assert.equal(reviewInput.safeParse(input).success, true);
    assert.equal(reviewInput.safeParse({ ...input, serviceGrade: "B+" }).success, false);
    assert.equal(reviewInput.safeParse({ ...input, attachmentIds: ["one", "one"] }).success, false);
  });
  it("limits bcrypt input bytes and rejects dangerous website protocols", () => {
    assert.equal(password.safeParse("a secure unique passphrase").success, true);
    assert.equal(password.safeParse("🙂".repeat(30)).success, false);
    assert.equal(password.safeParse("short").success, false);
    assert.equal(website.safeParse("javascript:alert(1)").success, false);
    assert.equal(website.safeParse("https://example.org").success, true);
  });
  it("rejects cross-origin and missing-origin writes", () => {
    process.env.APP_URL = "http://localhost:3000";
    assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/action", { headers: { origin: "http://localhost:3000" } })));
    assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/action", { headers: { origin: "https://attacker.example" } })));
    assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/action")));
    // Same host:port under a different address (127.0.0.1, LAN IP, tunnel)
    // passes; a different host or port still fails.
    assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/action", { headers: { origin: "http://127.0.0.1:3000" } })));
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://reviewmatters.org/api/action", { headers: { origin: "https://reviewmatters.org" } })));
    assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/action", { headers: { origin: "http://localhost:3001" } })));
  });
  it("enforces streamed request-size limits even without Content-Length", async () => {
    await assert.rejects(limitedBody(new Request("http://localhost", { method: "POST", body: "too much data" }), 4));
    assert.equal((await limitedBody(new Request("http://localhost", { method: "POST", body: "ok" }), 4)).toString(), "ok");
  });
  it("hashes passwords and session credentials without preserving plaintext", async () => {
    const plain = "an entirely unique passphrase";
    const hashed = await passwordHash(plain);
    assert.notEqual(hashed, plain);
    assert.equal(await passwordMatches(plain, hashed), true);
    assert.equal(await passwordMatches("another passphrase", hashed), false);
    assert.equal(digest("session-token").length, 64);
  });
  it("isolates pending, removed, and disabled-business evidence", () => {
    const item = { userId: "author", status: "PENDING", review: { status: "PENDING", business: { disabledAt: null as Date | null } } };
    assert.equal(canReadEvidence(item, null), false);
    assert.equal(canReadEvidence(item, { id: "stranger", role: "CUSTOMER" }), false);
    assert.equal(canReadEvidence(item, { id: "author", role: "CUSTOMER" }), true);
    assert.equal(canReadEvidence(item, { id: "moderator", role: "ADMIN" }), true);
    item.status = "PUBLISHED"; item.review.status = "PUBLISHED";
    assert.equal(canReadEvidence(item, null), true);
    item.review.business.disabledAt = new Date();
    assert.equal(canReadEvidence(item, null), false);
    item.review.business.disabledAt = null; item.status = "REMOVED";
    assert.equal(canReadEvidence(item, { id: "author", role: "CUSTOMER" }), false);
  });
});

describe("attachment processing", () => {
  it("rejects executable, SVG, PDF, truncated, and oversized files", async () => {
    for (const bytes of [Buffer.from("MZ executable"), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), Buffer.from("%PDF-1.7"), Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_UPLOAD + 1)]) await assert.rejects(sanitizeImage(bytes));
  });
  it("decodes and re-encodes images, removing metadata and trailing content", async () => {
    const image = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#7543e8" } }).jpeg().withMetadata().toBuffer();
    const sanitized = await sanitizeImage(Buffer.concat([image, Buffer.from("<script>private-payload</script>")]));
    const metadata = await sharp(sanitized).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 40);
    assert.equal(metadata.exif, undefined);
    assert.equal(sanitized.includes(Buffer.from("private-payload")), false);
  });
});

describe("business QR codes", () => {
  it("decodes to the canonical permanent profile URL, without credentials", async () => {
    const business = { slug: "permanent-business-4a9c", domain: "caspian.host" };
    const png = await businessQr(business, "png");
    assert.ok(png instanceof Uint8Array);
    const { data, info } = await sharp(Buffer.from(png)).resize(800, 800).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    assert.equal(code?.data, canonicalProfile(business));
    assert.equal(code?.data, "https://reviewmatters.org/review/caspian.host");
  });
  it("uses a cached result for the same identifier and supports SVG downloads", async () => {
    const business = { slug: "stable-profile" };
    assert.equal(businessQr(business, "png"), businessQr(business, "png"));
    const svg = await businessQr(business, "svg");
    assert.equal(typeof svg, "string");
    assert.match(String(svg), /<svg/);
  });
});

describe("business domains", () => {
  it("normalizes URLs, ports, credentials and www into a bare domain", () => {
    assert.equal(normalizeDomain("caspian.host"), "caspian.host");
    assert.equal(normalizeDomain("https://www.caspian.host/path?q=1#x"), "caspian.host");
    assert.equal(normalizeDomain("HTTP://Caspian.Host:8443/"), "caspian.host");
    assert.equal(normalizeDomain("user@caspian.host"), "caspian.host");
    assert.equal(normalizeDomain("www.sub.caspian.host"), "sub.caspian.host");
  });
  it("rejects values that are not valid domains", () => {
    for (const bad of ["localhost", "just-a-word", "-bad.com", "bad..com", "caspian_host", "example.c"]) {
      assert.equal(domainInput.safeParse(bad).success, false, bad);
    }
    assert.equal(domainInput.safeParse("caspian.host").success, true);
    assert.equal(domainInput.safeParse("sub.caspian.co.uk").success, true);
  });
});
