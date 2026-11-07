import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
async function main() {
  const p = new PrismaClient();
  try {
    const fixed = await p.$executeRaw`UPDATE "Business" SET domain = regexp_replace(domain, '[/?#:].*$', '') WHERE domain ~ '[/?#:]'`;
    console.log(`normalized ${fixed} domain value(s)`);
    const rows = await p.business.findMany({ select: { name: true, domain: true } });
    for (const b of rows) console.log(`${b.name}: ${b.domain}`);
  } finally { await p.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
