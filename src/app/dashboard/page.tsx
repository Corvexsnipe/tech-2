import Link from "next/link";
import { pageUser } from "@/lib/security";
import { db } from "@/lib/db";
import { businessReputation } from "@/lib/data";
import { DashboardNav } from "@/components/shell";
import { EmptyState, PageHeading } from "@/components/shared";
export const metadata = { title: "Business dashboard", robots: { index: false, follow: false } };
export default async function Dashboard() {
  const user = await pageUser();
  const [memberships, claims] = await Promise.all([
    db().membership.findMany({ where: { userId: user.id }, include: { business: true }, orderBy: { createdAt: "asc" } }),
    db().claim.findMany({ where: { userId: user.id }, include: { business: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const businesses = await Promise.all(memberships.map(async m => ({ ...m.business, stats: await businessReputation(m.businessId) })));
  return <div className="page-main"><div className="container"><PageHeading eyebrow="LISTEN. RESPOND. GROW." title="Your business, in perspective." description="Manage your public profile, respond to feedback, and invite your next customer to share an experience." /><DashboardNav />
    {businesses.length ? <div className="business-grid">{businesses.map(b => <div className="business-card" key={b.id}><div className="business-card-top"><span className="business-monogram">{b.name.slice(0, 2).toUpperCase()}</span><span className="rating-tag">{b.disabledAt ? "Unavailable" : b.stats.grade || "Not yet rated"}</span></div><h2>{b.name}</h2><p>{b.stats.count} published reviews · {b.city}</p>{b.disabledAt ? <p className="notice warning">This business is disabled. Contact the platform team for help.</p> : <Link href={`/dashboard/${b.id}`} className="text-link">Manage business →</Link>}</div>)}</div> : <EmptyState title="Your business dashboard starts here." description="Register or claim your business. Once an administrator verifies ownership, your profile and QR tools will appear here." href="/claim" label="Register or claim a business" />}
    {claims.length > 0 && <section style={{ marginTop: 35 }}><div className="section-title"><h2>Ownership requests</h2></div>{claims.map(c => <div className="admin-card" key={c.id}><div className="admin-card-head"><h3>{c.business.name}</h3><span className={`status-pill status-${c.status.toLowerCase()}`}>{c.status === "PUBLISHED" ? "APPROVED" : c.status}</span></div><p>{c.decision || "Awaiting administrator verification. No management permissions have been granted yet."}</p><small>Submitted {c.createdAt.toLocaleDateString()}</small></div>)}</section>}
  </div></div>;
}
