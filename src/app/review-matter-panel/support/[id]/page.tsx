import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, panelUser, staffList } from "@/lib/admin";
import { db } from "@/lib/db";
import { ActionForm, Field } from "@/components/forms";
import { AssignControl, StatusPill } from "@/components/admin-blocks";
import { TicketReplyForm } from "@/components/tickets";

const BASE = "/review-matter-panel/support";

export const metadata = { title: "Ticket", robots: { index: false, follow: false } };

export default async function TicketAdmin({ params }: { params: Promise<{ id: string }> }) {
  const me = await panelUser("MODERATOR");
  const { id } = await params;
  const [ticket, staff] = await Promise.all([
    db().ticket.findUnique({ where: { id }, include: {
      user: { select: { id: true, displayName: true, email: true, createdAt: true, disabledAt: true } },
      business: { select: { id: true, name: true, slug: true, disabledAt: true, _count: { select: { reviews: true } } } },
      assignee: { select: { displayName: true } },
      messages: { orderBy: { createdAt: "asc" }, include: {
        author: { select: { displayName: true, role: true } },
        attachments: { select: { id: true, label: true } },
      } },
      events: { orderBy: { createdAt: "asc" }, include: {} },
    } }),
    staffList(),
  ]);
  if (!ticket) notFound();
  const canAssign = hasRole(me, "ADMIN");

  return <>
    <div className="page-heading"><span className="eyebrow purple">TICKET #{ticket.number}</span><h1>{ticket.subject}</h1><p>{ticket.category} · opened {ticket.createdAt.toLocaleString()}</p></div>

    <div className="panel-grid-2">
      <section className="panel"><h3>Conversation</h3>
        <div className="ticket-thread">
          {ticket.messages.map(m => {
            const staffMsg = ["MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(m.author.role);
            return <article key={m.id} className={`ticket-message${staffMsg ? " staff" : ""}${m.internal ? " internal" : ""}`}>
              <header><strong>{m.author.displayName}</strong><span>{staffMsg ? "Support staff" : "Business owner"} · {m.createdAt.toLocaleString()}{m.internal && <span className="badge err" style={{ marginLeft: 6 }}>internal note</span>}</span></header>
              <p>{m.body}</p>
              {m.attachments.length > 0 && <div className="upload-list">{m.attachments.map(a => <a key={a.id} className="upload-item" href={`/api/evidence/${a.id}`} target="_blank" rel="noopener noreferrer">{
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/evidence/${a.id}`} alt={a.label} />
              }</a>)}</div>}
            </article>;
          })}
        </div>
        <h3 style={{ marginTop: 22 }}>Reply or note</h3>
        <TicketReplyForm ticketId={ticket.id} internal />
      </section>

      <div>
        <section className="panel"><h3>Ticket controls</h3>
          <table className="data-table" style={{ marginTop: 10 }}><tbody>
            <tr><td>Status</td><td><StatusPill status={ticket.status} /></td></tr>
            <tr><td>Priority</td><td>{ticket.priority.toLowerCase()}</td></tr>
            <tr><td>Assigned</td><td>{ticket.assignee?.displayName || "Unassigned"}</td></tr>
            <tr><td>Resolved</td><td>{ticket.resolvedAt ? ticket.resolvedAt.toLocaleString() : "—"}</td></tr>
          </tbody></table>
          <ActionForm action="admin-ticket-status" fixed={{ id: ticket.id }} label="Update status" className="panel-inline-form">
            <label className="field"><span>New status</span><select name="status" defaultValue={ticket.status}>
              {["OPEN", "IN_PROGRESS", "WAITING_OWNER", "RESOLVED", "CLOSED"].map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select></label>
            <Field label="Note for the owner (optional)" name="detail" required={false} maxLength={500} hint="Included in the status-change email."/>
          </ActionForm>
          <ActionForm action="admin-ticket-priority" fixed={{ id: ticket.id }} label="Update priority" className="panel-inline-form">
            <label className="field"><span>Priority</span><select name="priority" defaultValue={ticket.priority}>
              {["LOW", "NORMAL", "HIGH", "URGENT"].map(p => <option key={p} value={p}>{p.toLowerCase()}</option>)}
            </select></label>
          </ActionForm>
          {canAssign ? <AssignControl action="admin-ticket-assign" id={ticket.id} staff={staff} current={ticket.assigneeId} /> :
            <p style={{ fontSize: 11.5, marginTop: 10 }}>Assignment requires an admin role.</p>}
        </section>

        <section className="panel" style={{ marginTop: 16 }}><h3>Owner & business</h3>
          <p style={{ marginTop: 10, fontSize: 12.5 }}>
            <Link className="text-link" href={`/review-matter-panel/users/${ticket.user.id}`}>{ticket.user.displayName}</Link> · {ticket.user.email}
            <br />Member since {ticket.user.createdAt.toLocaleDateString()}{ticket.user.disabledAt && <span className="badge err" style={{ marginLeft: 6 }}>suspended</span>}
          </p>
          {ticket.business ? <p style={{ fontSize: 12.5, marginTop: 10 }}>
            Business: <Link className="text-link" href={`/review-matter-panel/businesses/${ticket.business.id}`}>{ticket.business.name}</Link> ({ticket.business._count.reviews} reviews){ticket.business.disabledAt && <span className="badge err" style={{ marginLeft: 6 }}>disabled</span>}
          </p> : <p style={{ fontSize: 12.5, marginTop: 10 }}>Not linked to a business profile.</p>}
        </section>

        <section className="panel" style={{ marginTop: 16 }}><h3>Activity history</h3>
          {ticket.events.map(e => <div className="audit-row" key={e.id}><p>{e.detail}</p><small>{e.createdAt.toLocaleString()}</small></div>)}
        </section>
      </div>
    </div>
    <p style={{ marginTop: 18 }}><Link className="text-link" href={BASE}>← Back to tickets</Link></p>
  </>;
}
