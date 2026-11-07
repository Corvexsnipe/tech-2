import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

// Live end-to-end verification of the anti-VPN engine against the running
// server and database. Uses throwaway users/businesses and documentation
// IP ranges (RFC 5737) seeded as fixtures; everything is removed at the end.
const BASE = process.env.APP_URL || "http://localhost:3000";
// Matches the cookie name of the server under test (`next start` = production).
const COOKIE = process.env.TARGET_ENV === "development" ? "rm_session" : "__Host-rm_session";
const RUN = Date.now().toString(36);
const FIX = "e2e-fixture";
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

async function main() {
  const { db } = await import("../src/lib/db");
  const { runSecurityCheck } = await import("../src/lib/security/review-security");
  const { businessReputation } = await import("../src/lib/data");
  const prisma = db();
  const created = { users: [] as string[], businesses: [] as string[], sessions: [] as string[] };

  const sha = (v: string) => createHash("sha256").update(v).digest("hex");
  async function user(tag: string, role: "CUSTOMER" | "SUPER_ADMIN" = "CUSTOMER") {
    const u = await prisma.user.create({ data: { email: `e2e-sec-${RUN}-${tag}@example.invalid`, displayName: `E2E ${tag}`, passwordHash: "x", verifiedAt: new Date(), role } });
    created.users.push(u.id);
    const token = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sha(token), userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    created.sessions.push(sha(token));
    return { id: u.id, cookie: `${COOKIE}=${token}` };
  }
  async function business(tag: string) {
    const b = await prisma.business.create({ data: { name: `E2E Security ${tag} ${RUN}`, slug: `e2e-sec-${tag}-${RUN}`, description: "Temporary business created by the anti-VPN end-to-end check.", category: "E2E", city: "Nowhere", supportEnabled: false } });
    created.businesses.push(b.id);
    return b.id;
  }
  async function post(cookie: string, ip: string, action: string, data: unknown) {
    const r = await fetch(`${BASE}/api/action`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie, "x-forwarded-for": ip }, body: JSON.stringify({ action, data }) });
    return { status: r.status, body: await r.json() as { message?: string; error?: string } };
  }
  const review = (businessId: string, n: number) => ({ businessId, headline: `E2E security review ${n} ${RUN}`, body: "Automated verification of the anti-VPN engine: this body exists only to satisfy validation and is deleted afterwards.", serviceGrade: "A", attachmentIds: [] });
  const state = (id: string) => prisma.review.findUniqueOrThrow({ where: { id }, include: { securityAssessment: true } });
  const byHeadline = (n: number) => prisma.review.findFirstOrThrow({ where: { headline: `E2E security review ${n} ${RUN}` }, include: { securityAssessment: true } });

  try {
    // Fixtures need *public* IPs: the resolver fails closed on private/doc
    // ranges (IP_NOT_PUBLIC → manual review) before feeds are consulted.
    // Candidates are real-routable addresses verified uncovered by the
    // imported datasets at runtime, then /32 fixture records seed the
    // endpoint categories.
    const covered = async (ip: string) =>
      (await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "IpIntelligenceRecord" WHERE "network" >>= ${ip}::inet`)[0].n > 0n;
    async function pickFree(candidates: string[]) {
      for (const ip of candidates) if (!(await covered(ip))) return ip;
      throw new Error(`no uncovered candidate in ${candidates.join(",")}`);
    }
    const [cleanIp, vpnIp, torIp, hostingIp, weakIp, raceIp] = await Promise.all([
      pickFree(["73.158.22.41", "98.97.140.12", "86.106.77.200", "24.130.55.19"]),
      pickFree(["185.234.72.10", "45.148.10.88", "91.219.29.66", "103.75.190.22"]),
      pickFree(["185.220.100.240", "45.154.98.11", "194.32.122.5", "171.25.193.77"]),
      pickFree(["23.129.64.9", "147.185.221.33", "89.187.164.50", "38.132.99.7"]),
      pickFree(["196.245.9.12", "89.46.100.77", "213.152.161.40", "5.61.34.90"]),
      pickFree(["79.127.99.18", "84.247.50.3", "46.151.209.40", "81.171.72.66"]),
    ]);
    await prisma.$executeRaw`DELETE FROM "IpIntelligenceRecord" WHERE source = ${FIX}`;
    const fixtures: [string, string, number][] = [[`${vpnIp}/32`, "VPN", 100], [`${torIp}/32`, "TOR", 95], [`${hostingIp}/32`, "HOSTING", 100], [`${weakIp}/32`, "VPN", 60]];
    for (const [cidr, category, confidence] of fixtures)
      await prisma.$executeRaw`INSERT INTO "IpIntelligenceRecord" ("id","cidr","network","ipVersion","category","source","confidence","firstSeenAt","lastUpdatedAt") VALUES (${`fix_${RUN}_${cidr}`}, ${cidr}, ${cidr}::cidr, 4, ${category}::"IpCategory", ${FIX}, ${confidence}, NOW(), NOW())`;
    const lookup = await prisma.$queryRaw<{ category: string }[]>`SELECT "category"::text FROM "IpIntelligenceRecord" WHERE "network" >>= ${vpnIp}::inet AND source = ${FIX}`;
    check("GiST cidr lookup finds the containing range", lookup.length === 1 && lookup[0].category === "VPN");

    const bizA = await business("A"), bizB = await business("B");
    const [u1, u2, u3, u4, u5, u6, u7, u8, u9] = await Promise.all(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"].map(t => user(t)));
    const admin = await user("admin", "SUPER_ADMIN");

    // 1. Clean IP (not in any list) → cleared, but stays PENDING until staff approve it.
    const r1 = await post(u1.cookie, cleanIp, "review-submit", review(bizA, 1));
    if (r1.status !== 200) throw new Error(`first submission failed: ${r1.status} ${r1.body.error}`);
    const s1 = await byHeadline(1);
    check("clean IP → SECURITY_CLEARED but PENDING (awaits staff approval)", r1.status === 200 && s1.status === "PENDING" && s1.securityState === "SECURITY_CLEARED", `${r1.status} ${r1.body.message} · ${s1.securityState} score ${s1.securityAssessment?.riskScore}`);
    check("clean IP → success message mentions staff approval", /submitted successfully!/.test(r1.body.message || "") && /approves it/.test(r1.body.message || ""), r1.body.message);
    const staffNotice = await prisma.notification.findFirst({ where: { userId: admin.id, href: `/review-matter-panel/reviews/${s1.id}` } });
    check("staff notified that a cleared review awaits approval", Boolean(staffNotice), staffNotice?.message);

    // 1b. Explicit staff approval is what publishes the review — no reason required for publish.
    const approve1 = await post(admin.cookie, "10.1.1.1", "admin-moderate", { id: s1.id, type: "review", status: "PUBLISHED" });
    const s1p = await state(s1.id);
    const publishNotice = await prisma.notification.findFirst({ where: { userId: u1.id }, orderBy: { createdAt: "desc" } });
    check("staff approve → PUBLISHED, reviewer notified", approve1.status === 200 && s1p.status === "PUBLISHED" && /now published/i.test(publishNotice?.message || ""), `${approve1.status} ${approve1.body.error} ${s1p.status} · ${publishNotice?.message}`);

    // 2. Known VPN endpoint → flagged, never published, excluded from grade.
    const r2 = await post(u2.cookie, vpnIp, "review-submit", review(bizA, 2));
    const s2 = await byHeadline(2);
    check("VPN IP → FLAGGED_VPN, status PENDING", r2.status === 200 && s2.securityState === "FLAGGED_VPN" && s2.status === "PENDING", `${s2.securityState}/${s2.status} score ${s2.securityAssessment?.riskScore} ${s2.securityAssessment?.classification}`);
    check("VPN IP → user told approval pending, no detection details leaked", /approves it/.test(r2.body.message || "") && !/vpn|proxy|tor/i.test(r2.body.message || ""), r2.body.message);

    // 3. Tor exit → flagged Tor.
    const r3 = await post(u3.cookie, torIp, "review-submit", review(bizA, 3));
    const s3 = await byHeadline(3);
    check("Tor IP → FLAGGED_TOR", r3.status === 200 && s3.securityState === "FLAGGED_TOR", `${s3.securityState} score ${s3.securityAssessment?.riskScore}`);

    // 4. Hosting-only → supporting signal, still cleared (but pending approval).
    const r4 = await post(u4.cookie, hostingIp, "review-submit", review(bizA, 4));
    const s4 = await byHeadline(4);
    check("hosting ASN only → cleared with recorded hosting signal", r4.status === 200 && s4.securityState === "SECURITY_CLEARED" && s4.status === "PENDING" && (s4.securityAssessment?.riskScore ?? 0) > 0 && (s4.securityAssessment?.riskScore ?? 99) < 30, `score ${s4.securityAssessment?.riskScore} signals ${JSON.stringify(s4.securityAssessment?.signals).slice(0, 120)}`);
    // Staff approves it so the aggregate checks below still reflect a published review.
    const approve4 = await post(admin.cookie, "10.1.1.1", "admin-moderate", { id: s4.id, type: "review", status: "PUBLISHED" });
    const s4p = await state(s4.id);
    check("staff approve hosting-signal review → PUBLISHED", approve4.status === 200 && s4p.status === "PUBLISHED", `${approve4.status} ${approve4.body.error} ${s4p.status}`);

    // 5. Weak single-source VPN evidence → manual review.
    const r5 = await post(u5.cookie, weakIp, "review-submit", review(bizA, 5));
    const s5 = await byHeadline(5);
    check("weak VPN evidence → MANUAL_REVIEW_REQUIRED", r5.status === 200 && s5.securityState === "MANUAL_REVIEW_REQUIRED" && s5.status === "PENDING", `${s5.securityState} score ${s5.securityAssessment?.riskScore}`);

    // 6. Duplicate IP, same business, different user → rejected with exact message.
    const r6 = await post(u6.cookie, cleanIp, "review-submit", review(bizA, 6));
    check("duplicate IP same business → 409 exact message", r6.status === 409 && r6.body.error === "You have already submitted a review for this business.", `${r6.status} ${r6.body.error}`);

    // 7. Same IP, different business → allowed.
    const r7 = await post(u6.cookie, cleanIp, "review-submit", review(bizB, 7));
    const s7 = await byHeadline(7);
    check("same IP different business → cleared, pending approval", r7.status === 200 && s7.status === "PENDING" && s7.securityState === "SECURITY_CLEARED", `${r7.status} ${s7.securityState}`);

    // 8. Concurrent duplicates from one IP to a fresh business → exactly one wins.
    const bizC = await business("C");
    const race = await Promise.all([post(u7.cookie, raceIp, "review-submit", review(bizC, 8)), post(u8.cookie, raceIp, "review-submit", review(bizC, 9))]);
    const winners = race.filter(r => r.status === 200).length, losers = race.filter(r => r.status === 409).length;
    const activeC = await prisma.review.count({ where: { businessId: bizC, status: { in: ["PENDING", "PUBLISHED", "HIDDEN", "INFO_REQUESTED"] } } });
    check("concurrent duplicates → one accepted, one 409, one active row", winners === 1 && losers === 1 && activeC === 1, `winners ${winners} losers ${losers} active ${activeC}`);

    // 9. Retry of the same submission (same user, same business) → no second review.
    const r9 = await post(u1.cookie, cleanIp, "review-submit", review(bizA, 1));
    const dupCount = await prisma.review.count({ where: { userId: u1.id, businessId: bizA } });
    check("submission retry → no duplicate review", r9.status === 409 && dupCount === 1, `${r9.status} rows ${dupCount}`);

    // 10. Aggregates count only eligible reviews.
    const rep = await businessReputation(bizA, 1);
    const eligible = await prisma.review.count({ where: { businessId: bizA, status: "PUBLISHED", securityState: "SECURITY_CLEARED" } });
    const submitted = await prisma.review.count({ where: { businessId: bizA } });
    // 6 rows: 5 submissions + the held duplicate (REJECTED). Only 2 are eligible.
    check("grade aggregate excludes flagged/pending/held reviews", rep.count === eligible && eligible === 2 && submitted === 6, `eligible ${eligible}/${submitted} submitted, rep.count ${rep.count}, score ${rep.score}, grade ${rep.grade}`);
    check("A grade unchanged for eligible reviews (A=80 → grade A)", rep.score === 80 && rep.grade === "A", `${rep.score} ${rep.grade}`);

    // 11. Moderation cannot publish a flagged review directly.
    const mod = await post(admin.cookie, "10.1.1.1", "admin-moderate", { id: s2.id, type: "review", status: "PUBLISHED", reason: "Trying to publish a flagged review." });
    check("moderation publish blocked while not cleared", mod.status === 409 && /security verification/i.test(mod.body.error || ""), `${mod.status} ${mod.body.error}`);

    // 12. Unauthorized user cannot use security actions.
    const forbidden = await post(u9.cookie, "10.1.1.1", "admin-security-decision", { id: s2.id, decision: "clear", reason: "Customer attempting override." });
    check("customer cannot issue security decisions", forbidden.status === 403, `${forbidden.status}`);

    // 13. Admin manual clear → published, audit row with actor, original assessment preserved.
    const clear = await post(admin.cookie, "10.1.1.1", "admin-security-decision", { id: s2.id, decision: "clear", reason: "Verified with the reviewer by phone; corporate VPN." });
    const s2b = await state(s2.id);
    const auditRows = await prisma.reviewSecurityAuditLog.findMany({ where: { reviewId: s2.id }, orderBy: { createdAt: "asc" } });
    const manual = auditRows.find(a => a.action === "manual-clear");
    check("manual clear → PUBLISHED + CLEARED, audited with actor and previous state", clear.status === 200 && s2b.status === "PUBLISHED" && s2b.securityState === "SECURITY_CLEARED" && manual?.actorId === admin.id && manual?.previousState === "FLAGGED_VPN" && s2b.securityAssessment?.classification === "VPN_DETECTED" && s2b.securityAssessment?.riskScore === 70, `${clear.status} ${s2b.status}/${s2b.securityState} audit ${auditRows.map(a => a.action).join(",")}`);
    const repAfterClear = await businessReputation(bizA, 1);
    check("aggregate recalculates after manual clear (idempotent read model)", repAfterClear.count === 3, `count ${repAfterClear.count}`);

    // 14. Admin reject → REJECTED, slot freed, assessment preserved.
    const reject = await post(admin.cookie, "10.1.1.1", "admin-security-decision", { id: s3.id, decision: "reject", reason: "Tor exit confirmed; policy does not allow anonymised reviews." });
    const s3b = await state(s3.id);
    check("manual reject → REJECTED, original FLAGGED_TOR assessment retained", reject.status === 200 && s3b.status === "REJECTED" && s3b.securityAssessment?.classification === "TOR_DETECTED", `${s3b.status} ${s3b.securityAssessment?.classification}`);

    // 15. Re-evaluation: a previously cleared, published review whose IP becomes listed is hidden and leaves the aggregate.
    await prisma.$executeRaw`INSERT INTO "IpIntelligenceRecord" ("id","cidr","network","ipVersion","category","source","confidence","firstSeenAt","lastUpdatedAt") VALUES (${`fix_${RUN}_reeval`}, ${`${cleanIp}/32`}, ${`${cleanIp}/32`}::cidr, 4, 'VPN', ${FIX}, 100, NOW(), NOW())`;
    const before = (await businessReputation(bizA, 1)).count;
    const re = await runSecurityCheck(s1.id, { force: true });
    const s1b = await state(s1.id);
    const after = (await businessReputation(bizA, 1)).count;
    check("feed update flags a cleared review → HIDDEN, removed from aggregate", re.state === "FLAGGED_VPN" && s1b.status === "HIDDEN" && before - after === 1, `${re.state} ${s1b.status} count ${before}→${after}`);

    // 16. Idempotency: repeated checks on a cleared review change nothing.
    const c1 = await businessReputation(bizA, 1);
    await runSecurityCheck(s4.id, { force: true }); await runSecurityCheck(s4.id, { force: true });
    const s4b = await state(s4.id); const c2 = await businessReputation(bizA, 1);
    check("repeated transitions are idempotent", s4b.status === "PUBLISHED" && s4b.securityState === "SECURITY_CLEARED" && c1.count === c2.count && c1.score === c2.score, `count ${c1.count}=${c2.count}`);

    // 17. Recheck on a cleared review via API requires staff; manual queue review re-check works.
    const recheck = await post(admin.cookie, "10.1.1.1", "admin-security-recheck", { id: s5.id });
    check("staff re-check runs and reports state", recheck.status === 200 && /manual review/i.test(recheck.body.message || ""), `${recheck.status} ${recheck.body.message}`);

    // 18. Missing/untrusted IP → manual review, never cleared.
    const r18 = await post(u9.cookie, "", "review-submit", review(bizB, 18));
    const s18 = await byHeadline(18);
    check("no resolvable IP → MANUAL_REVIEW_REQUIRED (IP_UNAVAILABLE), not published", r18.status === 200 && s18.securityState === "MANUAL_REVIEW_REQUIRED" && s18.status === "PENDING", `${s18.securityState}/${s18.status}`);

    // 18b. A non-public resolved IP (private/loopback/doc range) can never be
    // verified — it must hold for manual review rather than clear as clean.
    const u10 = await user("u10");
    created.users.push(u10.id);
    const r18b = await post(u10.cookie, "192.0.2.44", "review-submit", review(bizB, 19));
    const s18b = await byHeadline(19);
    check("non-public client IP → MANUAL_REVIEW_REQUIRED (IP_NOT_PUBLIC)", r18b.status === 200 && s18b.securityState === "MANUAL_REVIEW_REQUIRED" && s18b.status === "PENDING" && s18b.securityAssessment?.lastError === "IP_NOT_PUBLIC", `${s18b.securityState}/${s18b.status} ${s18b.securityAssessment?.lastError}`);

    // 19. Security pages and health endpoint respond for staff and hide from others.
    for (const [path, cookie, expected] of [["/review-matter-panel/security", admin.cookie, 200], ["/review-matter-panel/security?queue=flagged&reason=VPN_DETECTED", admin.cookie, 200], [`/review-matter-panel/reviews/${s2.id}`, admin.cookie, 200], ["/api/admin/security", admin.cookie, 200], ["/api/admin/security", u9.cookie, 404]] as const) {
      const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
      check(`GET ${path} → ${expected}`, r.status === expected, String(r.status));
    }
    const health = await (await fetch(`${BASE}/api/admin/security`, { headers: { cookie: admin.cookie } })).text();
    check("health endpoint contains no IP addresses", !new RegExp(`${cleanIp.replace(/\./g, "\\.")}|${vpnIp.replace(/\./g, "\\.")}`).test(health));
  } finally {
    // Cleanup: reviews cascade to assessments and audit rows.
    await prisma.review.deleteMany({ where: { businessId: { in: created.businesses } } });
    await prisma.notification.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created.users } }, { targetId: { in: created.businesses } }] } });
    await prisma.emailLog.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.session.deleteMany({ where: { id: { in: created.sessions } } });
    await prisma.business.deleteMany({ where: { id: { in: created.businesses } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$executeRaw`DELETE FROM "IpIntelligenceRecord" WHERE source = ${FIX}`;
    await prisma.$disconnect();
    console.log(`\ncleanup done · ${failures} failure(s)`);
    if (failures) process.exitCode = 1;
  }
}
main().catch(error => { console.error("e2e crashed:", error instanceof Error ? error.message : error); process.exitCode = 1; });
