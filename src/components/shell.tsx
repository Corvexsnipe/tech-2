"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowUpRight, MessageSquare } from "lucide-react";
import { useState } from "react";
import { ActionForm } from "./forms";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Review Matters home"><span className="brand-icon"><MessageSquare size={20} strokeWidth={2.5} /><span /></span><span>review<span className="brand-light">matters</span><i /></span></Link>;
}
export function Header({ user }: { user: { displayName: string; role: string } | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (pathname.startsWith("/review-matter-panel")) return null;
  return <header className={`site-header${pathname === "/" ? " home-header" : ""}`}><div className="container nav-wrap">
    <Brand />
    <button className="menu-button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    <nav id="main-navigation" className={open ? "nav-links open" : "nav-links"} aria-label="Main navigation">
      {[["/explore", "Explore businesses"], ["/how-it-works", "How it works"], ["/for-businesses", "For businesses"]].map(([href, label]) => <Link key={href} href={href} className={pathname === href ? "active" : ""} onClick={() => setOpen(false)}>{label}</Link>)}
      <div className="nav-actions">
        {user ? <><Link href="/account" onClick={() => setOpen(false)}>My account</Link><Link href={["MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(user.role) ? "/review-matter-panel" : "/dashboard"} className="button primary small" onClick={() => setOpen(false)}>Dashboard <ArrowUpRight size={15} /></Link></> :
          <><Link href="/sign-in" onClick={() => setOpen(false)}>Sign in</Link><Link href="/register" className="button primary small" onClick={() => setOpen(false)}>Get started <ArrowUpRight size={15} /></Link></>}
      </div>
    </nav>
  </div></header>;
}
export function Announcement({ text }: { text: string }) {
  const pathname = usePathname();
  if (pathname.startsWith("/review-matter-panel")) return null;
  return <div className="announcement" role="status">{text}</div>;
}
export function Footer() {
  const pathname = usePathname();
  if (pathname.startsWith("/review-matter-panel")) return null;
  return <footer className={`site-footer${pathname === "/" ? " home-footer" : ""}`}><div className="container footer-main"><div><Brand /><p>Every experience has a story.<br />Every review matters.</p><span className="footer-tag"><span /> Clarity starts with real experiences.</span></div>
    <div><strong>Discover</strong><Link href="/">Home</Link><Link href="/explore">Explore businesses</Link><Link href="/how-it-works">How it works</Link></div>
    <div><strong>For your business</strong><Link href="/for-businesses">For businesses</Link><Link href="/claim">Register or claim</Link><Link href="/sign-in">Sign in</Link></div>
    <div><strong>Good to know</strong><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of use</Link><Link href="/contact">Contact</Link></div>
  </div><div className="container footer-bottom"><span>© {new Date().getFullYear()} Review Matters. All rights reserved.</span><span>Real reviews. Clearer decisions.</span></div></footer>;
}
export function DashboardNav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname();
  return <div className="dashboard-tabs">
    {(admin ? [["/review-matter-panel", "Admin panel"]] : [["/account", "My reviews"], ["/account/settings", "Account settings"], ["/dashboard", "My businesses"], ["/dashboard/support", "Support"], ["/claim", "Register a business"]]).map(([href, label]) => <Link key={href} href={href} className={pathname === href || (href === "/dashboard/support" && pathname.startsWith("/dashboard/support")) ? "active" : ""}>{label}</Link>)}
    <ActionForm action="logout" label="Sign out" className="logout-form" />
  </div>;
}
