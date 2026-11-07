import { PrismaClient } from "@prisma/client";

const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const configured = () => Boolean(process.env.DATABASE_URL);
export function db() {
  if (!configured()) throw new AppError("Database setup is pending. Please try again after the platform is configured.", 503);
  if (!globalDb.prisma) globalDb.prisma = new PrismaClient({ log: [] });
  return globalDb.prisma;
}

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function appUrl() {
  const value = process.env.APP_URL || "http://localhost:3000";
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !local) throw new AppError("A secure application URL must be configured.", 503);
  return url.origin;
}

// Canonical public profile path. New businesses use their domain
// (/review/caspian.host); older listings keep their slug working.
export const profileSlug = (business: { slug: string; domain?: string | null }) => business.domain || business.slug;
export const canonicalProfile = (business: { slug: string; domain?: string | null }) => `https://reviewmatters.org/review/${encodeURIComponent(profileSlug(business))}`;
