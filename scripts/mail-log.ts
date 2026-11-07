import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
async function main() {
  const p = new PrismaClient();
  try {
    const logs = await p.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { kind: true, status: true, recipient: true, detail: true, dedupeKey: true, createdAt: true } });
    for (const l of logs) console.log(`${l.createdAt.toISOString()}  ${l.kind}  → ${l.recipient}  [${l.status}]  key=${l.dedupeKey ?? "-"}${l.detail ? "  " + l.detail.slice(0, 150) : ""}`);
    const msgs = await p.ticketMessage.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { ticket: { select: { number: true, user: { select: { email: true } } } }, author: { select: { role: true } } } });
    console.log("--- recent ticket messages ---");
    for (const m of msgs) console.log(`${m.createdAt.toISOString()}  ticket ${m.ticket.number}  author role=${m.author.role}  internal=${m.internal}  owner=${m.ticket.user.email}`);
  } finally { await p.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
