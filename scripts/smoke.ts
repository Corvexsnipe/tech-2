import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

// Exercises real constraints end-to-end against the connected database, then
// removes every record it created. Safe to run repeatedly.
async function main() {
  const prisma = new PrismaClient({ log: [] });
  const suffix = `smoke-${Date.now()}`;
  const ids: { user?: string; business?: string; review?: string; contact?: string } = {};
  try {
    const contact = await prisma.contactMessage.create({ data: {
      email: "smoke@test.invalid", name: "Smoke Test", subject: `Connectivity check ${suffix}`,
      body: "Automated connectivity check. This record is deleted by the same script.",
    } });
    ids.contact = contact.id;
    const user = await prisma.user.create({ data: {
      email: `${suffix}@test.invalid`, displayName: "Smoke Test", passwordHash: "not-a-real-hash", verifiedAt: new Date(),
    } });
    ids.user = user.id;
    const business = await prisma.business.create({ data: {
      name: `Smoke Test Business ${suffix}`, slug: `smoke-test-${suffix}`, description: "Automated migration verification record.",
      category: "Test", city: "Test", supportEnabled: true,
    } });
    ids.business = business.id;
    const review = await prisma.review.create({ data: {
      userId: user.id, businessId: business.id, headline: "Connectivity smoke test",
      body: "Verifying unique active keys and serializable transactions.",
      serviceGrade: "A_PLUS", supportGrade: "B", supportSnapshot: true, score: 85,
      activeKey: JSON.stringify([user.id, business.id]),
    } });
    ids.review = review.id;
    let duplicateBlocked = false;
    try {
      await prisma.review.create({ data: {
        userId: user.id, businessId: business.id, headline: "Duplicate active review",
        body: "This must be rejected by the unique constraint.",
        serviceGrade: "D", supportSnapshot: true, score: 15,
        activeKey: JSON.stringify([user.id, business.id]),
      } });
    } catch { duplicateBlocked = true; }
    const count = await prisma.review.count({ where: { businessId: business.id } });
    console.log(JSON.stringify({ connected: true, duplicateBlocked, reviewCount: count }, null, 2));
    if (!duplicateBlocked || count !== 1) throw new Error("Duplicate review constraint failed.");
  } finally {
    if (ids.review) await prisma.review.delete({ where: { id: ids.review } });
    if (ids.business) await prisma.business.delete({ where: { id: ids.business } });
    if (ids.user) await prisma.user.delete({ where: { id: ids.user } });
    if (ids.contact) await prisma.contactMessage.delete({ where: { id: ids.contact } });
    await prisma.$disconnect();
  }
  console.log("Smoke test passed; all test records removed.");
}
main().catch(error => { console.error(error instanceof Error ? error.message.slice(0, 200) : "Smoke test failed"); process.exitCode = 1; });
