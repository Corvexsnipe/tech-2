import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/review-matter-panel", "/admin", "/account", "/dashboard", "/api", "/claim", "/sign-in", "/register", "/verify-email", "/reset-password", "/forgot-password", "/resend-verification"] },
    sitemap: "https://reviewmatters.org/sitemap.xml",
  };
}
