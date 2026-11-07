import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { normalizeIp, ipHash } from "../src/lib/ip";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

// Exercises the review IP restriction at the database layer:
// normalization, hashing, uniqueness, and the release of a slot on removal.
async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!user) throw new Error("No admin user to attach test records to.");
  const ids: string[] = [];
  try {
    assert(normalizeIp(" 203.0.113.7 ") === "203.0.113.7", "trims whitespace");
    assert(normalizeIp("[2001:db8::1]:443") === "2001:db8::1", "strips ipv6 brackets");
    assert(normalizeIp("::ffff:192.0.2.1") === "192.0.2.1", "unwraps v4-mapped");
    assert(normalizeIp("not-an-ip") === null, "rejects garbage");
    assert(ipHash("1.2.3.4") === ipHash("1.2.3.4") && ipHash("1.2.3.4") !== ipHash("1.2.3.5"), "hmac deterministic");

    const business = await prisma.business.create({ data: { name: "IP TEST CO", slug: `ip-test-${Date.now()}`, description: "Temporary IP-check business record for automated verification.", category: "Test", city: "Testville", disabledAt: new Date() } });
    const hashA = ipHash("198.51.100.23"), hashB = ipHash("203.0.113.9");
    const r1 = await prisma.review.create({ data: { userId: user.id, businessId: business.id, headline: "First visit here", body: "Automated test review number one for the IP restriction check.", serviceGrade: "A", score: 80, supportSnapshot: false, status: "PUBLISHED", activeKey: "t1", ipHash: hashA } });
    ids.push(r1.id, business.id);
    console.log("first review from IP A: PUBLISHED");

    let dupUser = false;
    try { await prisma.review.create({ data: { userId: user.id, businessId: business.id, headline: "Second visit here", body: "Second attempt from the same network should be rejected.", serviceGrade: "B", score: 70, supportSnapshot: false, status: "PUBLISHED", activeKey: "t2", ipHash: hashA } }); }
    catch (e) { dupUser = e instanceof Error && e.message.includes("Unique constraint"); }
    assert(dupUser, "same IP + same business rejected by unique index");
    console.log("second review same IP/business: REJECTED by index");

    const other = await prisma.business.create({ data: { name: "IP TEST CO 2", slug: `ip-test-b-${Date.now()}`, description: "Temporary second business for the IP restriction check.", category: "Test", city: "Testville", disabledAt: new Date() } });
    ids.push(other.id);
    const r3 = await prisma.review.create({ data: { userId: user.id, businessId: other.id, headline: "Different business", body: "Same network reviewing a different business is allowed.", serviceGrade: "C", score: 50, supportSnapshot: false, status: "PUBLISHED", activeKey: "t3", ipHash: hashA } });
    ids.push(r3.id);
    console.log("same IP, different business: ALLOWED");

    const r4 = await prisma.review.create({ data: { userId: user.id, businessId: business.id, headline: "Different network", body: "A different network reviewing the same business is allowed.", serviceGrade: "D", score: 15, supportSnapshot: false, status: "PUBLISHED", activeKey: "t4", ipHash: hashB } });
    ids.push(r4.id);
    console.log("different IP, same business: ALLOWED");

    await prisma.review.update({ where: { id: r1.id }, data: { status: "REMOVED" } });
    const r5 = await prisma.review.create({ data: { userId: user.id, businessId: business.id, headline: "After removal", body: "A removed review frees the network slot for a new review.", serviceGrade: "A", score: 80, supportSnapshot: false, status: "PUBLISHED", activeKey: "t5", ipHash: hashA } });
    ids.push(r5.id);
    console.log("same IP after original removed: ALLOWED (slot freed)");
  } finally {
    await prisma.review.deleteMany({ where: { headline: { contains: " " }, userId: user.id, activeKey: { in: ["t1", "t2", "t3", "t4", "t5"] } } }).catch(() => {});
    await prisma.review.deleteMany({ where: { userId: user.id, activeKey: { startsWith: "t" } } }).catch(() => {});
    await prisma.business.deleteMany({ where: { name: { startsWith: "IP TEST CO" } } }).catch(() => {});
    await prisma.$disconnect();
  }
  console.log("IP restriction checks passed.");
}
const assert = (v: unknown, m: string) => { if (!v) throw new Error(`FAILED: ${m}`); };
main().catch(e => { console.error(e.message); process.exitCode = 1; });
