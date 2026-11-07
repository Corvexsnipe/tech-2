import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

const assert = (v: unknown, m: string) => { if (!v) throw new Error(`FAILED: ${m}`); };

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!user) throw new Error("No admin user found.");
  const ticketIds: string[] = [];
  try {
    // Two tickets get distinct sequential numbers from the sequence.
    const t1 = await prisma.ticket.create({ data: { userId: user.id, subject: "Verification question", category: "Business Profile Verification", messages: { create: { authorId: user.id, body: "First ticket body for the automated check." } }, events: { create: { actorId: user.id, detail: "Ticket created." } } } });
    const t2 = await prisma.ticket.create({ data: { userId: user.id, subject: "Billing question", category: "Billing and Subscription" } });
    ticketIds.push(t1.id, t2.id);
    assert(/^BUS-\d{5,}$/.test(t1.number) && /^BUS-\d{5,}$/.test(t2.number) && t1.number !== t2.number, `sequential numbers (got ${t1.number}, ${t2.number})`);
    console.log(`sequential ticket numbers: ${t1.number}, ${t2.number}`);

    // Internal notes are excluded by the owner-side query.
    await prisma.ticketMessage.create({ data: { ticketId: t1.id, authorId: user.id, body: "internal note", internal: true } });
    const ownerView = await prisma.ticket.findFirst({ where: { id: t1.id, userId: user.id }, include: { messages: { where: { internal: false } } } });
    assert(ownerView?.messages.length === 1 && !ownerView.messages.some(m => m.internal), "internal notes hidden from owner query");
    console.log("owner query excludes internal notes");

    // Status transition + resolvedAt.
    await prisma.ticket.update({ where: { id: t1.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    const resolved = await prisma.ticket.findUnique({ where: { id: t1.id } });
    assert(resolved?.status === "RESOLVED" && resolved.resolvedAt, "status/resolvedAt transition");
    console.log("status transitions + resolvedAt work");
  } finally {
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.$disconnect();
  }
  console.log("Ticket checks passed.");
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
