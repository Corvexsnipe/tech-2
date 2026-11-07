import Link from "next/link";
import { pageUser } from "@/lib/security";
import { db } from "@/lib/db";
import { DashboardNav } from "@/components/shell";
import { PageHeading } from "@/components/shared";
import { TicketCreateForm } from "@/components/tickets";

export const metadata = { title: "New support ticket", robots: { index: false, follow: false } };

export default async function NewTicket() {
  const user = await pageUser();
  const memberships = await db().membership.findMany({ where: { userId: user.id }, include: { business: { select: { id: true, name: true, disabledAt: true } } } });
  const businesses = memberships.map(m => m.business).filter(b => !b.disabledAt);
  return <div className="page-main"><div className="container">
    <PageHeading eyebrow="SUPPORT" title="Create a ticket." description="Tell us what you need. Our team replies by email and in this dashboard." />
    <DashboardNav />
    <div className="dashboard-grid">
      <section className="panel">
        {!user.verifiedAt ? <p className="notice warning">Please verify your email before creating a ticket.</p> : <TicketCreateForm businesses={businesses} />}
      </section>
      <aside className="panel"><h2>Before you write</h2>
        <p>Choose the closest category — it routes your ticket to the right team. For verification questions, include your business website.</p>
        <div className="auth-points"><span>01 · Describe the issue clearly</span><span>02 · Attach screenshots if helpful</span><span>03 · We reply by email and here</span></div>
        <p style={{ marginTop: 25 }}><Link href="/dashboard/support" className="text-link">← Back to tickets</Link></p>
      </aside>
    </div>
  </div></div>;
}
