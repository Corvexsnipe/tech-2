"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity, BadgeCheck, BarChart3, Bell, Building2, ChevronsLeft, ChevronsRight, Flag, Globe,
  ArrowUpRight, ChevronDown, LayoutDashboard, LifeBuoy, Mail, Menu, Network, Paperclip, ScrollText, Search, Settings, ShieldAlert, ShieldCheck, Star, Tags, Users, X,
} from "lucide-react";
import { Brand } from "./shell";
import { ActionForm } from "./forms";

export const PANEL_NAV = [
  ["/review-matter-panel", "Overview", LayoutDashboard],
  ["/review-matter-panel/users", "Users & Roles", Users],
  ["/review-matter-panel/businesses", "Businesses", Building2],
  ["/review-matter-panel/claims", "Business Claims", BadgeCheck],
  ["/review-matter-panel/reviews", "Reviews & Moderation", Star],
  ["/review-matter-panel/attachments", "Proof Attachments", Paperclip],
  ["/review-matter-panel/reports", "Reports & Disputes", Flag],
  ["/review-matter-panel/security", "Security Center", ShieldAlert],
  ["/review-matter-panel/ips", "Review IP Log", Network],
  ["/review-matter-panel/support", "Support Tickets", LifeBuoy],
  ["/review-matter-panel/categories", "Categories", Tags],
  ["/review-matter-panel/analytics", "Analytics & Exports", BarChart3],
  ["/review-matter-panel/notifications", "Notifications & Email", Mail],
  ["/review-matter-panel/team", "Admin Team", ShieldCheck],
  ["/review-matter-panel/audit", "Audit & Security", ScrollText],
  ["/review-matter-panel/settings", "Platform Settings", Settings],
  ["/review-matter-panel/seo", "SEO & Content", Globe],
  ["/review-matter-panel/system", "System Health", Activity],
] as const;

const LABELS: Record<string, string> = Object.fromEntries(PANEL_NAV.map(([href, label]) => [href.split("/").pop()!, label]));

export function PanelShell({ user, unread, children }: { user: { displayName: string; email: string; role: string }; unread: number; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const profile = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean).slice(1);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLButtonElement>(".panel-close")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key !== "Tab") return;
      const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>("a, button") ?? []).filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    const onResize = () => { if (window.innerWidth > 900) setOpen(false); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    const trigger = menuButton.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      trigger?.focus();
    };
  }, [open]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profile.current && !profile.current.contains(event.target as Node)) profile.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const groups = [
    { label: "Workspace", items: PANEL_NAV.slice(0, 4) },
    { label: "Trust & moderation", items: PANEL_NAV.slice(4, 10) },
    { label: "Platform", items: PANEL_NAV.slice(10) },
  ];
  return <div className={`panel-shell${collapsed ? " collapsed" : ""}`}>
    {open && <button className="panel-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setOpen(false)} />}
    <aside ref={sidebar} id="admin-navigation" className={`panel-sidebar${open ? " open" : ""}`} aria-label="Admin navigation" role={open ? "dialog" : undefined} aria-modal={open || undefined}>
      <div className="panel-brand"><Brand /><button className="menu-button panel-close" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <div className="panel-workspace">Administration</div>
      <nav className="panel-nav">
        {groups.map(group => <div className="panel-nav-group" key={group.label}><p className="panel-nav-label">{group.label}</p>{group.items.map(([href, label, Icon]) => {
          const active = href === "/review-matter-panel" ? pathname === href : pathname.startsWith(href);
          return <Link key={href} href={href} aria-label={label} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} /><span>{label}</span></Link>;
        })}</div>)}
      </nav>
      <div className="panel-sidebar-foot">
        <Link href="/" className="panel-back">View website <ArrowUpRight size={14} /></Link>
        <button className="panel-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}</button>
      </div>
    </aside>
    <div className="panel-main" inert={open}>
      <header className="panel-topbar">
        <button ref={menuButton} className="menu-button panel-menu-toggle" aria-label="Open menu" aria-expanded={open} aria-controls="admin-navigation" onClick={() => setOpen(true)}><Menu size={19} /></button>
        <nav className="panel-crumbs" aria-label="Breadcrumb">
          <Link href="/review-matter-panel">Admin</Link>
          {segments.map((seg, i) => <span key={i}> / {LABELS[seg] || (seg.length > 12 ? "Record" : seg)}</span>)}
        </nav>
        <form className="panel-search" action="/review-matter-panel/search" role="search">
          <Search size={17} /><input name="q" placeholder="Search users, businesses, reviews" maxLength={100} aria-label="Global admin search" /><button type="submit" aria-label="Search workspace"><ArrowUpRight size={16} /></button>
        </form>
        <Link href="/account" className="panel-bell" aria-label={`${unread} unread notifications`}><Bell size={18} />{unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}</Link>
        <details className="panel-profile" ref={profile} onKeyDown={e => { if (e.key === "Escape" && profile.current) { profile.current.open = false; profile.current.querySelector("summary")?.focus(); } }}>
          <summary aria-label="Account menu"><span className="panel-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="panel-user"><strong>{user.displayName}</strong><span>{user.role.replaceAll("_", " ")}</span></span><ChevronDown size={14} /></summary>
          <div className="panel-account-menu"><p>{user.email}</p><Link href="/account" onClick={() => { if (profile.current) profile.current.open = false; }}>My account <ArrowUpRight size={14} /></Link><Link href="/account/settings" onClick={() => { if (profile.current) profile.current.open = false; }}>Account settings <Settings size={14} /></Link><ActionForm action="logout" label="Sign out" className="panel-logout" /></div>
        </details>
      </header>
      <div key={pathname} className="panel-content">{children}</div>
    </div>
  </div>;
}
