import Link from "next/link";
import { pageUser } from "@/lib/security";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { DashboardNav } from "@/components/shell";
import { EmptyState, PageHeading, Pagination } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";

const BASE = "/dashboard/support";
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_OWNER", "RESOLVED", "CLOSED"] as const;

export const metadata = { title: "Support tickets", robots: { index: false, follow: false } };

export default async function Support({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await pageUser();
  const params = await searchParams;
  const q = (params.q || "").slice(0, 100).trim();
  const status = STATUSES.find(s => s === params.status);
  const page = pageNumber(params.page), take = 12, skip = (page - 1) * take;
  const where = { userId: user.id, ...(status ? { status } : {}), ...(q ? { OR: [
    { subject: { contains: q, mode: "insensitive" as const } },
    { number: { contains: q, mode: "insensitive" as const } },
  ] } : {}) };
  const [tickets, total, stats] = await Promise.all([
    db().ticket.findMany({ where, orderBy: { updatedAt: "desc" }, take, skip, include: { business: { select: { name: true } }, _count: { select: { messages: true } } } }),
    db().ticket.count({ where }),
    db().ticket.groupBy({ by: ["status"], where: { userId: user.id }, _count: true }),
  ]);
  const count = (s: string) => stats.find(g => g.status === s)?._count || 0;
  const openTotal = count("OPEN") + count("IN_PROGRESS") + count("WAITING_OWNER");

  return <div className="page-main"><div className="container">
    <PageHeading eyebrow="WE'RE HERE TO HELP" title="Support tickets." description="Get help with your listing, reviews, verification, or account. Replies arrive by email and appear here." />
    <DashboardNav />
    <div className="metric-grid">
      <div className="metric-card"><span>Total tickets</span><strong>{stats.reduce((n, g) => n + g._count, 0)}</strong></div>
      <div className="metric-card"><span>Open</span><strong>{openTotal}</strong></div>
      <div className="metric-card"><span>Awaiting your reply</span><strong>{count("WAITING_OWNER")}</strong></div>
      <div className="metric-card"><span>Resolved</span><strong>{count("RESOLVED") + count("CLOSED")}</strong></div>
    </div>
    <div className="panel-toolbar">
      <form className="search-bar" style={{ gridTemplateColumns: "1fr auto auto", margin: 0 }} action={BASE} role="search">
        <input name="q" defaultValue={q} placeholder="Search subject or ticket #…" maxLength={100} aria-label="Search tickets" />
        <select name="status" defaultValue={status || ""} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <button className="button primary">Filter</button>
      </form>
      <Link href="/dashboard/support/new" className="button primary small">New ticket</Link>
    </div>
    {total === 0 ? <EmptyState title="No tickets yet." description="Questions about your listing, a review, or verification? Open a ticket and our team will help." href="/dashboard/support/new" label="Create a ticket" /> :
      <table className="data-table"><thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>Status</th><th>Created</th><th>Updated</th><th></th></tr></thead><tbody>
        {tickets.map(t => <tr key={t.id}>
          <td><code style={{ fontSize: 11 }}>#{t.number}</code></td>
          <td><Link className="text-link" href={`${BASE}/${t.id}`}>{t.subject}</Link><br /><small style={{ color: "var(--muted)" }}>{t.business?.name || "Account"} · {t._count.messages} message{t._count.messages === 1 ? "" : "s"}</small></td>
          <td><small>{t.category}</small></td>
          <td><StatusPill status={t.status} />{t.priority !== "NORMAL" && <span className={`badge ${t.priority === "URGENT" ? "err" : "warn"}`} style={{ marginLeft: 4 }}>{t.priority.toLowerCase()}</span>}</td>
          <td><small>{t.createdAt.toLocaleDateString()}</small></td>
          <td><small>{t.updatedAt.toLocaleDateString()}</small></td>
          <td><Link className="text-link" href={`${BASE}/${t.id}`}>Open →</Link></td>
        </tr>)}
      </tbody></table>}
    <Pagination base={BASE} query={{ q, status: status || "" }} page={page} total={total} pageSize={take} />
  </div></div>;
}
