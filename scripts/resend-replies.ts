import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { sendMailResilient } from "../src/lib/mail";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

async function main() {
  const p = new PrismaClient();
  try {
    const failed = await p.emailLog.findMany({ where: { status: "failed", kind: "ticket-reply-owner", dedupeKey: { startsWith: "ticket-reply-owner:" } } });
    if (failed.length === 0) { console.log("No failed reply notifications to resend."); return; }
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    for (const log of failed) {
      const messageId = log.dedupeKey!.split(":")[1];
      const message = await p.ticketMessage.findUnique({ where: { id: messageId }, include: { ticket: { include: { user: { select: { id: true, email: true } } } } } });
      if (!message || message.internal) { console.log(`skip ${log.id}: message gone or internal`); continue; }
      await sendMailResilient(message.ticket.user, "ticket-reply-owner", {
        name: message.ticket.user.email,
        number: message.ticket.number,
        subject: message.ticket.subject,
        preview: message.body.slice(0, 160),
        url: `${appUrl}/dashboard/support/${message.ticket.id}`,
      });
      console.log(`resent reply notification for ${message.ticket.number} -> ${message.ticket.user.email}`);
    }
  } finally { await p.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
