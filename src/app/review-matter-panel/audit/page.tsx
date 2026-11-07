import { hoursAgo, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { EmptyState, Pagination } from "@/components/shared";

const BASE = "/review-matter-panel/audit";

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await panelUser("ADMIN");
  const params = await searchParams;
  const action = (params.action || "").slice(0, 60);
  const page = pageNumber(params.page), take = 40, skip = (page - 1) * take;
  const where = action ? { action } : {};
  const dayAgo = hoursAgo(24);
  const [logs, count, failedLogins, logins, sessions, buckets] = await Promise.all([
    db().auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    db().auditLog.count({ where }),
    db().auditLog.count({ where: { action: "login-failed", createdAt: { gte: dayAgo } } }),
    db().auditLog.count({ where: { action: "login", createdAt: { gte: dayAgo } } }),
    db().session.count({ where: { expiresAt: { gt: new Date() } } }),
    db().rateBucket.count({ where: { expiresAt: { gt: new Date() } } }),
  ]);
  const actions = await db().auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 20 });

  return <>
    <div className="page-heading"><span className="eyebrow purple">AUDIT & SECURITY</span><h1>Append-only record.</h1><p>Administrative, account, and ownership actions. Logs are retained for accountability.</p></div>
    <div className="metric-grid">
      <div className="metric-card"><span>Sign-ins (24h)</span><strong>{logins}</strong></div>
      <div className="metric-card"><span>Failed sign-ins (24h)</span><strong>{failedLogins}</strong></div>
      <div className="metric-card"><span>Active sessions</span><strong>{sessions}</strong></div>
      <div className="metric-card"><span>Rate-limit windows</span><strong>{buckets}</strong><small>currently throttling</small></div>
    </div>
    <form className="search-bar" style={{ gridTemplateColumns: "1fr auto" }} action={BASE}>
      <select name="action" defaultValue={action} aria-label="Filter by action">
        <option value="">All actions</option>
        {actions.map(a => <option key={a.action} value={a.action}>{a.action} ({a._count._all})</option>)}
      </select>
      <button className="button primary">Filter</button>
    </form>
    {count === 0 ? <EmptyState title="No records." description="Audited actions appear here." /> :
      <section className="panel">{logs.map(log => <div className="audit-row" key={log.id}>
        <strong>{log.action}</strong><p>{log.detail}</p>
        <small>{log.createdAt.toISOString()} · Actor: {log.actorId || "system"} · Record: {log.targetId}</small>
      </div>)}</section>}
    <Pagination base={BASE} query={{ action }} page={page} total={count} pageSize={take} />
    <p className="notice" style={{ marginTop: 16 }}>Session revocation lives on each user record. Backups and restores run at the database provider level — this panel never exports credentials or attachment contents.</p>
  </>;
}
