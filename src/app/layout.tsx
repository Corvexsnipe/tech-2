import type { Metadata, Viewport } from "next";
import { Announcement, Header, Footer } from "@/components/shell";
import { currentUser } from "@/lib/security";
import { configured, db } from "@/lib/db";
import "./globals.css";

const FALLBACK_TITLE = "Review Matters — Real Reviews. Clear Grades.";
const FALLBACK_DESCRIPTION = "Discover businesses through customer experiences, transparent grades, and optional supporting evidence. Every review matters.";

export async function generateMetadata(): Promise<Metadata> {
  let title = FALLBACK_TITLE, description = FALLBACK_DESCRIPTION;
  if (configured()) {
    const config = await db().platformConfig.findUnique({ where: { id: "platform" } }).catch(() => null);
    if (config) { title = config.siteTitle; description = config.siteDescription; }
  }
  return {
    metadataBase: new URL("https://reviewmatters.org"),
    title: { default: title, template: "%s | Review Matters" },
    description,
    openGraph: { type: "website", siteName: "Review Matters", title, description },
    robots: { index: true, follow: true },
  };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7543e8" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  const announcement = configured() ? (await db().platformConfig.findUnique({ where: { id: "platform" }, select: { announcement: true } }).catch(() => null))?.announcement : null;
  return <html lang="en" data-scroll-behavior="smooth"><body><a href="#main-content" className="skip-link">Skip to content</a>{announcement && <Announcement text={announcement} />}<Header user={user ? { displayName: user.displayName, role: user.role } : null} /><main id="main-content">{children}</main><Footer /></body></html>;
}
