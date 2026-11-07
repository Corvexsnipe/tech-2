import type { MetadataRoute } from "next";
import { configured, db } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages = ["", "/explore", "/how-it-works", "/for-businesses", "/privacy", "/terms", "/contact", "/sign-in", "/register"].map(path => ({
    url: `https://reviewmatters.org${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.6,
  }));
  if (!configured()) return staticPages;
  const businesses = await db().business.findMany({ where: { disabledAt: null }, select: { slug: true, domain: true, updatedAt: true }, take: 5000 }).catch(() => []);
  return [...staticPages, ...businesses.map(b => ({ url: `https://reviewmatters.org/review/${b.domain || b.slug}`, lastModified: b.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 }))];
}
