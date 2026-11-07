import dns from "node:dns";
import nodemailer from "nodemailer";
import { AppError, appUrl, db } from "./db";
import { digest, token } from "./security";

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

// Operations inbox for new tickets and unassigned owner replies.
export const SUPPORT_ALERT_EMAIL = process.env.SUPPORT_ALERT_EMAIL || "zaidirehan904@gmail.com";

// Minimal branded HTML wrapper; the plain-text body remains the fallback.
function toHtml(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6935d8">$1</a>');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f7f5fb;font-family:Arial,Helvetica,sans-serif;color:#221633"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e9e4f2;border-radius:12px;padding:28px"><div style="font-size:17px;font-weight:700;color:#49278f;margin-bottom:18px">review<span style="font-weight:400">matters</span></div><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${linked}</div><p style="font-size:10.5px;color:#9a8cae;margin-top:26px;border-top:1px solid #eee8f6;padding-top:14px">Review Matters · Real reviews. Clearer decisions.</p></div></body></html>`;
}

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; description: string }> = {
  verify: {
    subject: "Verify your Review Matters email",
    body: "Hello {{name}},\n\nVerify your email using this link:\n\n{{url}}\n\nIf you did not request this, ignore this email. Never share this link.",
    description: "Sent when someone registers or requests a new verification link. Placeholders: {{name}}, {{url}}",
  },
  reset: {
    subject: "Reset your Review Matters password",
    body: "Hello {{name}},\n\nReset your password using this link:\n\n{{url}}\n\nIf you did not request this, ignore this email. Never share this link.",
    description: "Sent for password reset requests. Placeholders: {{name}}, {{url}}",
  },
  "review-confirmation": {
    subject: "Your Review Has Been Submitted – Review Matters",
    body: "Hi,\n\nThank you for sharing your experience on Review Matters!\n\nYour review has been submitted successfully and is now published on the platform.\n\nWe appreciate you taking the time to help others make better decisions.\n\nThank you,\nTeam Review Matters\n{{url}}",
    description: "Sent after a review is saved and published. Placeholders: {{name}}, {{business}}, {{url}}",
  },
  "ticket-confirmation": {
    subject: "Support ticket {{ticket}} received – Review Matters",
    body: "Hi {{name}},\n\nYour support ticket {{ticket}} has been created.\n\nSubject: {{subject}}\nCategory: {{category}}\n\nOur team will review it and reply by email and in your dashboard. You can follow the conversation here:\n\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Confirmation sent to the ticket creator. Placeholders: {{name}}, {{ticket}}, {{subject}}, {{category}}, {{url}}",
  },
  "ticket-alert": {
    subject: "New support ticket {{ticket}}: {{subject}}",
    body: "A new support ticket was created.\n\nTicket: {{ticket}}\nSubject: {{subject}}\nCategory: {{category}}\nBusiness: {{business}}\nFrom: {{name}} <{{email}}>\nSubmitted: {{created}}\n\nMessage preview:\n{{preview}}\n\nOpen the ticket: {{url}}",
    description: "Staff alert for new tickets and unassigned owner replies. Placeholders: {{ticket}}, {{subject}}, {{category}}, {{business}}, {{name}}, {{email}}, {{created}}, {{preview}}, {{url}}",
  },
  "ticket-reply-owner": {
    subject: "New reply on ticket {{ticket}} – Review Matters",
    body: "Hi {{name}},\n\nOur support team replied to your ticket {{ticket}} ({{subject}}).\n\nReply preview:\n{{preview}}\n\nView the conversation and respond: {{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the business owner when staff reply. Placeholders: {{name}}, {{ticket}}, {{subject}}, {{preview}}, {{url}}",
  },
  "ticket-reply-staff": {
    subject: "Owner replied on ticket {{ticket}}: {{subject}}",
    body: "The business owner replied to a ticket.\n\nTicket: {{ticket}}\nSubject: {{subject}}\nBusiness: {{business}}\nFrom: {{name}} <{{email}}>\n\nReply preview:\n{{preview}}\n\nOpen the ticket: {{url}}",
    description: "Sent to the assigned staff member (or the support inbox) when an owner replies. Placeholders: {{ticket}}, {{subject}}, {{business}}, {{name}}, {{email}}, {{preview}}, {{url}}",
  },
  "ticket-status": {
    subject: "Ticket {{ticket}} is now {{status}} – Review Matters",
    body: "Hi {{name}},\n\nThe status of your support ticket {{ticket}} ({{subject}}) changed to {{status}}.\n\n{{detail}}\n\nView the ticket: {{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the owner when a ticket status changes. Placeholders: {{name}}, {{ticket}}, {{subject}}, {{status}}, {{detail}}, {{url}}",
  },
  "claim-approval": {
    subject: "Your ownership of {{business}} was approved – Review Matters",
    body: "Hi {{name}},\n\nGood news — your ownership claim for {{business}} has been verified and approved.\n\nYou can now manage the business profile, reply to reviews, print your QR poster, and handle support tickets from your dashboard:\n\n{{url}}\n\nThank you,\nTeam Review Matters",
    description: "Sent to the claimant when an administrator approves a business ownership claim. Placeholders: {{name}}, {{business}}, {{url}}",
  },
  "domain-proof": {
    subject: "Action needed: verify your domain for {{business}} – Review Matters",
    body: "Hi {{name}},\n\nTo continue your ownership verification for {{business}}, please prove control of {{website}}.\n\nAdd the following line where it is publicly visible on the website — for example in a page footer or a page linked from the homepage:\n\nreviewmatters-verification: {{code}}\n\nAlternatively, reply to this email from an email address on the business domain.\n\nOnce it is in place, let us know and an administrator will complete the check.\n\nThank you,\nTeam Review Matters",
    description: "Sent when an admin requests domain proof for a claim or ownership report. Placeholders: {{name}}, {{business}}, {{website}}, {{code}}",
  },
};

async function transport() {
  const host = process.env.SMTP_HOST || "";
  const secure = process.env.SMTP_SECURE === "true";
  // Node's bundled resolver (c-ares) can end up pointed at DNS servers that
  // never answer — e.g. a VPN's loopback resolver — failing every SMTP connect
  // with "queryA ETIMEOUT". Resolve through the OS resolver instead and keep
  // the real hostname for TLS SNI/certificate validation.
  let address = host;
  try { address = (await dns.promises.lookup(host)).address; } catch { /* keep hostname */ }
  return nodemailer.createTransport({
    host: address,
    port: Number(process.env.SMTP_PORT || 587),
    secure,
    requireTLS: !secure,
    ...(address !== host ? { tls: { servername: host } } : {}),
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
  });
}

async function render(kind: string, vars: Record<string, string>) {
  const stored = await db().emailTemplate.findUnique({ where: { key: kind } }).catch(() => null);
  const template = stored || DEFAULT_TEMPLATES[kind];
  if (!template) throw new AppError("This email type is not configured.", 503);
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
  return { subject: fill(template.subject), body: fill(template.body) };
}

export async function sendMail(user: { id?: string; email: string }, kind: string, vars: Record<string, string>, dedupeKey?: string) {
  if (!mailConfigured()) throw new AppError("Email delivery is not configured. Please contact the platform operator.", 503);
  const { subject, body } = await render(kind, vars);
  // A dedupe key reserves the send before delivery so retries of the same
  // logical email never produce duplicates. The row is updated with the
  // outcome after the attempt.
  let logId: string | null = null;
  if (dedupeKey) {
    try {
      const row = await db().emailLog.create({ data: { userId: user.id || null, recipient: user.email, kind, status: "queued", dedupeKey } });
      logId = row.id;
    } catch {
      return; // A send for this key is already queued or completed.
    }
  }
  const smtp = await transport();
  let status = "sent", detail = "";
  try {
    await smtp.sendMail({ from: process.env.MAIL_FROM, to: user.email, subject, text: body, html: toHtml(body) });
  } catch (error) {
    status = "failed";
    detail = error instanceof Error ? error.message.slice(0, 300) : "Delivery failed.";
  } finally {
    smtp.close();
  }
  // A failed send releases its dedupe key so the same logical email can be
  // legitimately resent; the failed row stays in the log for the operator.
  if (logId) await db().emailLog.update({ where: { id: logId }, data: { status, detail, ...(status === "failed" ? { dedupeKey: null } : {}) } }).catch(() => {});
  else await db().emailLog.create({ data: { userId: user.id || null, recipient: user.email, kind, status, detail } }).catch(() => {});
  if (status === "failed") throw new AppError("The email could not be sent. Please try again later.", 503);
}

// Retries temporary delivery failures (e.g. SMTP timeouts). Only the first
// attempt carries the dedupe key, so a queued/sent email is never duplicated.
export async function sendMailResilient(user: { id?: string; email: string }, kind: string, vars: Record<string, string>, dedupeKey?: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sendMail(user, kind, vars, attempt === 0 ? dedupeKey : undefined);
      return;
    } catch {
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

// Fired after a review is committed. Delivery is retried on failure; the
// review stays published regardless of the outcome. Safe to call without
// awaiting — every attempt is recorded in the email log.
export async function sendReviewConfirmation(user: { id: string; email: string; displayName?: string | null }, reviewId: string, businessName: string) {
  await sendMailResilient(user, "review-confirmation", { name: user.displayName || user.email, business: businessName, url: `${appUrl()}/` }, `review-confirmation:${reviewId}`);
}

export async function sendAccountEmail(user: { id: string; email: string; displayName?: string }, kind: "verify" | "reset") {
  const raw = token();
  const id = digest(raw);
  await db().accountToken.create({ data: { id, userId: user.id, kind, expiresAt: new Date(Date.now() + (kind === "reset" ? 3600_000 : 86400_000)) } });
  const url = `${appUrl()}/${kind === "verify" ? "verify-email" : "reset-password"}?token=${raw}`;
  try {
    await sendMail(user, kind, { name: user.displayName || user.email, url });
  } catch (error) {
    await db().accountToken.deleteMany({ where: { id } });
    throw error;
  }
}
