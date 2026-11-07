import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

async function main() {
  const email = process.env.CHECK_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Set CHECK_EMAIL.");
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, verifiedAt: true, disabledAt: true, createdAt: true, sessions: { select: { createdAt: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 3 } } });
    console.log(JSON.stringify(user, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
