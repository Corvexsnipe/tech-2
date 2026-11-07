import { PrismaClient } from "@prisma/client";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

async function main() {
  if (!process.env.DATABASE_URL || !process.env.UPLOAD_DIR || !path.isAbsolute(process.env.UPLOAD_DIR)) throw new Error("Database and absolute private upload directory must be configured.");
  const prisma = new PrismaClient({ log: [] });
  try {
    const now = new Date(), cutoff = new Date(Date.now() - 86400_000);
    await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.accountToken.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.rateBucket.deleteMany({ where: { expiresAt: { lt: now } } });
    const orphans = await prisma.attachment.findMany({ where: { reviewId: null, createdAt: { lt: cutoff } }, take: 1000 });
    for (const item of orphans) {
      const deleted = await prisma.attachment.deleteMany({ where: { id: item.id, reviewId: null, createdAt: { lt: cutoff } } });
      if (deleted.count && /^[a-f0-9]{48}\.webp$/.test(item.storageKey)) await unlink(path.join(process.env.UPLOAD_DIR, item.storageKey)).catch(() => {});
    }
    console.log("Expired credentials, rate buckets, and orphaned uploads cleaned. Reviews and audit records were preserved.");
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Maintenance failed. Check configuration privately."); process.exitCode = 1; });
