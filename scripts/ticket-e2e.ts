import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (!process.env.ADMIN_EMAIL && existsSync(".env")) process.loadEnvFile();

// End-to-end: signed-in user creates a ticket through the real action API,
// staff replies, status changes — then verifies DB rows and the email log.
async function main() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD.");
  const prisma = new PrismaClient();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let ticketId = "";
  try {
    await page.goto("http://localhost:3000/sign-in");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/account", { timeout: 15000 });

    // Owner-facing pages render.
    const listPage = await page.goto("http://localhost:3000/dashboard/support");
    console.log("GET /dashboard/support:", listPage?.status());
    const newPage = await page.goto("http://localhost:3000/dashboard/support/new");
    console.log("GET /dashboard/support/new:", newPage?.status());

    // Real submission through the action endpoint (same-origin, session cookie).
    const created = await page.evaluate(async () => {
      const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ticket-create", data: { subject: "Automated e2e ticket", category: "Technical Issue", body: "This is an automated end-to-end verification of the ticket system." } }) });
      return { status: r.status, body: await r.json() };
    });
    console.log("ticket-create:", created.status, created.body.message || created.body.error);
    if (created.status !== 200) throw new Error("ticket-create failed");

    const ticket = await prisma.ticket.findFirst({ where: { subject: "Automated e2e ticket" }, include: { messages: true, events: true } });
    if (!ticket) throw new Error("ticket row missing");
    ticketId = ticket.id;
    console.log(`ticket row: ${ticket.number}, ${ticket.messages.length} message(s), ${ticket.events.length} event(s)`);

    // Staff reply through the API.
    const reply = await page.evaluate(async (id) => {
      const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin-ticket-reply", data: { id, body: "Staff reply from the automated check.", internal: false } }) });
      return { status: r.status, body: await r.json() };
    }, ticket.id);
    console.log("admin-ticket-reply:", reply.status, reply.body.message || reply.body.error);

    // Internal note — must be invisible to the owner query.
    await page.evaluate(async (id) => {
      await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin-ticket-reply", data: { id, body: "Private internal note from the automated check.", internal: true } }) });
    }, ticket.id);
    const ownerView = await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id, internal: false } });
    const allMsgs = await prisma.ticketMessage.count({ where: { ticketId: ticket.id } });
    console.log(`messages: ${allMsgs} total, ${ownerView.length} visible to owner`);

    // Status change.
    const status = await page.evaluate(async (id) => {
      const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin-ticket-status", data: { id, status: "WAITING_OWNER" } }) });
      return { status: r.status, body: await r.json() };
    }, ticket.id);
    console.log("admin-ticket-status:", status.status, status.body.message || status.body.error);

    // Ticket detail pages render.
    const ownerDetail = await page.goto(`http://localhost:3000/dashboard/support/${ticket.id}`);
    const adminDetail = await page.goto(`http://localhost:3000/review-matter-panel/support/${ticket.id}`);
    console.log("owner detail:", ownerDetail?.status(), "| admin detail:", adminDetail?.status());
    const internalLeak = await page.locator("text=Private internal note").count();
    console.log("internal note leaked to admin detail only:", internalLeak === 1);

    // Wait for async emails, then inspect the log.
    await page.waitForTimeout(6000);
    const logs = await prisma.emailLog.findMany({ where: { kind: { in: ["ticket-alert", "ticket-confirmation", "ticket-reply-owner", "ticket-status"] }, createdAt: { gt: new Date(Date.now() - 120000) } }, select: { kind: true, status: true, recipient: true, dedupeKey: true } });
    console.log("email log:", JSON.stringify(logs));
  } finally {
    if (ticketId) {
      await prisma.emailLog.deleteMany({ where: { dedupeKey: { contains: ticketId } } });
      const msgIds = (await prisma.ticketMessage.findMany({ where: { ticketId }, select: { id: true } })).map(m => m.id);
      await prisma.attachment.updateMany({ where: { ticketMessageId: { in: msgIds } }, data: { ticketMessageId: null } });
      await prisma.ticket.delete({ where: { id: ticketId } });
    }
    await prisma.$disconnect();
    await browser.close();
  }
  console.log("ticket e2e passed.");
}
main().catch(e => { console.error(e.message.slice(0, 400)); process.exitCode = 1; });
