import nodemailer from "nodemailer";
import { existsSync } from "node:fs";

if (!process.env.SMTP_HOST && existsSync(".env")) process.loadEnvFile();

// Verifies SMTP credentials only — sends no email.
async function main() {
  if (!process.env.SMTP_HOST) throw new Error("SMTP not configured");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_SECURE !== "true",
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
  });
  await transport.verify();
  console.log("SMTP credentials verified — authentication succeeded.");
  transport.close();
}
main().catch(error => { console.error("SMTP check failed:", error instanceof Error ? error.message.slice(0, 300) : "unknown"); process.exitCode = 1; });
