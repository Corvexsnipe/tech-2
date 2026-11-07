import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
async function main() {
  const prisma = new PrismaClient({ log: [] });
  try {
    const rows = await prisma.$queryRawUnsafe<{ pid: number; usename: string; state: string; query: string; wait_event: string | null }[]>(
      `SELECT a.pid, a.usename, a.state, left(a.query, 80) AS query, a.wait_event
       FROM pg_stat_activity a
       JOIN pg_locks l ON l.pid = a.pid
       WHERE l.locktype = 'advisory'`);
    console.log(JSON.stringify(rows, null, 2));
    if (process.argv.includes("--kill")) {
      for (const r of rows) {
        await prisma.$queryRawUnsafe("SELECT pg_terminate_backend($1::int)", r.pid);
        console.log("terminated", r.pid);
      }
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  const msg = error instanceof Error ? error.message.replace(/:\/\/[^:@]+:[^@]+@/, "://***:***@") : "unknown";
  console.error("Lock inspection failed:", msg.slice(0, 300));
  process.exitCode = 1;
});
