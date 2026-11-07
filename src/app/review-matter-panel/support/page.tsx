import Link from "next/link";
import { panelUser, staffList } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { EmptyState, Pagination } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";
import { TICKET_CATEGORIES } from "@/lib/validation";

const BASE = "/review-matter-panel/support";
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_OWNER", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const metadata = { title: "Support tickets", robots: { index: false, follow: false } };

export default async function SupportQueue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await panelUser("MODERATOR");
  const params = await searchParams;
  const q = (params.q || "").slice(0, 100).trim();
  const status = STATUSES.find(s => s === params.status);
  const category = TICKET_CATEGORIES.find(c => c === params.category);
  const priority = PRIORITIES.find(p => p === params.priority);
  const page = pageNumber(params.page), take = 15, skip = (page - 1) * take;
  const where = {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(priority ? { priority } : {}),
    ...(params.assignee === "me" ? {} : params.assignee ? { assigneeId: params.assignee } : {}),
    ...(q ? { OR: [
      { number: { contains: q, mode: "insensitive" as const } },
      { subject: { contains: q, mode: "insensitive" as const } },
      { user: { email: { contains: q, mode: "insensitive" as const } } },
      { business: { name: { contains: q, mode: "insensitive" as const } } },
    ] } : {}),
  };
  const [tickets, total, staff, stats] = await Promise.all([
    db().ticket.findMany({ where, orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }], take, skip, include: {
      user: { select: { displayName: true, email: true } },
      business: { select: { name: true } },
      assignee: { select: { displayName: true } },
      _count: { select: { messages: true } },
    } }),
    db().ticket.count({ where }),
    staffList(),
    db().ticket.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = (s: string) => stats.find(g => g.status === s)?._count || 0;

  return <>
    <div className="page-heading"><span className="eyebrow purple">SUPPORT DESK</span><h1>Business support tickets.</h1><p>Every ticket is a conversation thread — reply, assign, and track it through resolution.</p></div>
    <div className="metric-grid">
      <div className="metric-card"><span>Open</span><strong>{count("OPEN")}</strong></div>
      <div className="metric-card"><span>In progress</span><strong>{count("IN_PROGRESS")}</strong></div>
      <div className="metric-card"><span>Waiting on owner</span><strong>{count("WAITING_OWNER")}</strong></div>
      <div className="metric-card"><span>Resolved / closed</span><strong>{count("RESOLVED") + count("CLOSED")}</strong></div>
    </div>
    <form className="search-bar" style={{ gridTemplateColumns: "1fr auto auto auto auto auto" }} action={BASE} role="search">
      <input name="q" defaultValue={q} placeholder="Ticket #, subject, business, or owner email…" maxLength={100} aria-label="Search tickets" />
      <select name="status" defaultValue={status || ""} aria-label="Status"><option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
      <select name="category" defaultValue={category || ""} aria-label="Category"><option value="">All categories</option>{TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
      <select name="priority" defaultValue={priority || ""} aria-label="Priority"><option value="">All priorities</option>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select>
      <select name="assignee" defaultValue={params.assignee || ""} aria-label="Assignee"><option value="">Any assignee</option>{staff.map(s => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select>
      <button className="button primary">Search</button>
    </form>
    {total === 0 ? <EmptyState title="No matching tickets." description="New tickets from business owners will appear here." /> :
      <table className="data-table"><thead><tr><th>Ticket</th><th>Subject</th><th>Owner</th><th>Business</th><th>Status</th><th>Priority</th><th>Assigned</th><th>Updated</th><th></th></tr></thead><tbody>
        {tickets.map(t => <tr key={t.id}>
          <td><code style={{ fontSize: 11 }}>#{t.number}</code></td>
          <td><Link className="text-link" href={`${BASE}/${t.id}`}>{t.subject}</Link><br /><small style={{ color: "var(--muted)" }}>{t.category} · {t._count.messages} msg</small></td>
          <td><small>{t.user.displayName}<br />{t.user.email}</small></td>
          <td><small>{t.business?.name || "—"}</small></td>
          <td><StatusPill status={t.status} /></td>
          <td>{t.priority !== "NORMAL" ? <span className={`badge ${t.priority === "URGENT" ? "err" : t.priority === "HIGH" ? "warn" : "dim"}`}>{t.priority.toLowerCase()}</span> : <small>normal</small>}</td>
          <td><small>{t.assignee?.displayName || "Unassigned"}</small></td>
          <td><small>{t.updatedAt.toLocaleDateString()}</small></td>
          <td><Link className="text-link" href={`${BASE}/${t.id}`}>Open →</Link></td>
        </tr>)}
      </tbody></table>}
    <Pagination base={BASE} query={{ q, status: status || "", category: category || "", priority: priority || "", assignee: params.assignee || "" }} page={page} total={total} pageSize={take} />
  </>;
}
