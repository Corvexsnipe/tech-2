import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser } from "@/lib/security";
import { db } from "@/lib/db";
import { DashboardNav } from "@/components/shell";
import { PageHeading } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";
import { TicketReplyForm } from "@/components/tickets";

export const metadata = { title: "Support ticket", robots: { index: false, follow: false } };

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser();
  const { id } = await params;
  const ticket = await db().ticket.findFirst({ where: { id, userId: user.id }, include: {
    business: { select: { name: true, slug: true } },
    // Internal notes are excluded at the query level — they never reach the page.
    messages: { where: { internal: false }, orderBy: { createdAt: "asc" }, include: {
      author: { select: { displayName: true, role: true } },
      attachments: { select: { id: true, label: true } },
    } },
    events: { orderBy: { createdAt: "asc" } },
  } });
  if (!ticket) notFound();

  return <div className="page-main"><div className="container">
    <PageHeading eyebrow={`TICKET #${ticket.number}`} title={ticket.subject} description={`${ticket.category}${ticket.business ? ` · ${ticket.business.name}` : ""}`} />
    <DashboardNav />
    <div className="dashboard-grid">
      <section className="panel">
        <div className="admin-card-head"><StatusPill status={ticket.status} /><small>{ticket.priority !== "NORMAL" ? `${ticket.priority.toLowerCase()} priority · ` : ""}opened {ticket.createdAt.toLocaleString()}</small></div>
        <div className="ticket-thread">
          {ticket.messages.map(m => {
            const staff = ["MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(m.author.role);
            return <article key={m.id} className={`ticket-message${staff ? " staff" : ""}`}>
              <header><strong>{staff ? "Support team" : m.author.displayName}</strong><span>{staff ? "Support staff" : "You"} · {m.createdAt.toLocaleString()}</span></header>
              <p>{m.body}</p>
              {m.attachments.length > 0 && <div className="upload-list">{m.attachments.map(a => <a key={a.id} className="upload-item" href={`/api/evidence/${a.id}`} target="_blank" rel="noopener noreferrer">{
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/evidence/${a.id}`} alt={a.label} />
              }</a>)}</div>}
            </article>;
          })}
        </div>
        <h3 style={{ marginTop: 24 }}>Reply</h3>
        <TicketReplyForm ticketId={ticket.id} closed={ticket.status === "CLOSED"} />
      </section>
      <aside className="panel"><h2>Ticket activity</h2>
        {ticket.events.map(e => <p key={e.id} style={{ marginTop: 10, fontSize: 12 }}>{e.detail}<br /><small style={{ color: "var(--muted)" }}>{e.createdAt.toLocaleString()}</small></p>)}
        <p style={{ marginTop: 22 }}><Link href="/dashboard/support" className="text-link">← All tickets</Link></p>
      </aside>
    </div>
  </div></div>;
}
