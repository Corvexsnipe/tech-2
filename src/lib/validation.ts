import { z } from "zod";
import { GRADES } from "./grades";
import { AppError } from "./db";

export const id = z.string().min(1).max(100);
export const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const password = z.string().min(12, "Use at least 12 characters.").refine(v => Buffer.byteLength(v, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes.");
export const email = z.email().max(254).transform(v => v.toLowerCase().trim());
export const grade = z.enum(GRADES);
export const website = z.union([z.literal(""), z.url().max(500).refine(v => ["https:", "http:"].includes(new URL(v).protocol), "Use an http or https URL.")]).optional();

// Strips scheme, credentials, port, path and a leading www, then lowercases —
// accepts "caspian.host" as well as "https://www.caspian.host/page".
export function normalizeDomain(raw: string) {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^[^@/]*@/, "");
  value = value.split(/[/?#]/, 1)[0];
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^www\./, "").replace(/\.$/, "");
  return value;
}
export const domainInput = z.string().trim().max(253).transform(normalizeDomain)
  .refine(v => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v), "Enter a valid domain, for example caspian.host.");
export const businessFields = {
  name: text(2, 100), description: text(20, 2000),
  category: text(2, 60), city: text(2, 100), website,
  supportEnabled: z.boolean(),
};
export const TICKET_CATEGORIES = [
  "Business Profile Verification",
  "Fake or Fraudulent Review Report",
  "Review Dispute or Moderation Appeal",
  "Business Ownership Transfer",
  "Business Profile Information Correction",
  "Account and Login Issues",
  "Billing and Subscription",
  "Technical Issue",
  "Other",
] as const;

export const reviewInput = z.object({
  businessId: id, headline: text(5, 120), body: text(30, 5000),
  serviceGrade: grade, supportGrade: grade.optional(),
  attachmentIds: z.array(id).max(4).default([]),
}).refine(v => new Set(v.attachmentIds).size === v.attachmentIds.length, "Duplicate attachment.");

export async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max) throw new AppError("Request is too large.", 413);
  if (!request.body) throw new AppError("A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) { await reader.cancel(); throw new AppError("Request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
