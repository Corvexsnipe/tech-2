import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.contactMessage.deleteMany({ where: { email: "preview@example.org" } });
    console.log(`Removed test contact messages: ${result.count}`);
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Cleanup failed."); process.exitCode = 1; });
