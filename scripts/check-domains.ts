import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
async function main() {
  const p = new PrismaClient();
  try {
    const rows = await p.business.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true, domain: true, website: true, disabledAt: true } });
    for (const b of rows) console.log(`${b.name} | slug=${b.slug} | domain=${b.domain} | website=${b.website} | disabled=${b.disabledAt}`);
  } finally { await p.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
