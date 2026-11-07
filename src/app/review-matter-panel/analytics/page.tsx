import Link from "next/link";
import { dateRange, inRange, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { eligibleReviews } from "@/lib/data";
import { GRADE_LABELS } from "@/lib/grades";
import { EmptyState } from "@/components/shared";

const BASE = "/review-matter-panel/analytics";

export default async function Analytics({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await panelUser("MODERATOR");
  const params = await searchParams;
  const range = dateRange(params.range, params.from, params.to);
  const created = inRange(range);

  const [usersNew, businessesNew, submitted, published, claimsDecided, reportsResolved, moderationLogs, reviews] = await Promise.all([
    db().user.count({ where: { createdAt: created } }),
    db().business.count({ where: { createdAt: created } }),
    db().review.count({ where: { createdAt: created } }),
    db().review.count({ where: { createdAt: created, ...eligibleReviews } }),
    db().claim.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: created } }),
    db().report.count({ where: { createdAt: created, status: { not: "PENDING" } } }),
    db().auditLog.findMany({ where: { action: "admin-moderate", createdAt: created }, select: { targetId: true, createdAt: true } }),
    db().review.findMany({ where: eligibleReviews, select: { score: true, serviceGrade: true, supportGrade: true, supportSnapshot: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 2000 }),
  ]);
  const reportKinds = await db().report.groupBy({ by: ["kind"], _count: { _all: true }, where: { createdAt: created } });
  const claimByStatus = Object.fromEntries(claimsDecided.map(c => [c.status, c._count._all]));

  // Moderation turnaround: time between review submission and its first moderation audit entry.
  const reviewDates = new Map((await db().review.findMany({ where: { id: { in: moderationLogs.map(l => l.targetId) } }, select: { id: true, createdAt: true } })).map(r => [r.id, r.createdAt]));
  const turnarounds = moderationLogs.filter(l => reviewDates.get(l.targetId)).map(l => (l.createdAt.getTime() - reviewDates.get(l.targetId)!.getTime()) / 3600_000);
  const avgTurnaround = turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : null;

  const grades: Record<string, number> = { A_PLUS: 0, A: 0, B: 0, C: 0, D: 0 };
  let serviceSum = 0, supportSum = 0, supportN = 0;
  for (const r of reviews) { grades[r.serviceGrade]++; serviceSum += r.score; if (r.supportGrade) { supportSum += r.score; supportN++; } }

  return <>
    <div className="page-heading"><span className="eyebrow purple">ANALYTICS & EXPORTS</span><h1>Platform signals.</h1><p>Aggregates computed live from the database for {range.label.toLowerCase()}. All figures reflect real records only.</p></div>
    <div className="range-bar">
      {[["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]].map(([key, label]) =>
        <Link key={key} href={`${BASE}?range=${key}`} className={range.key === key ? "active" : ""}>{label}</Link>)}
      <form action={BASE}><input type="hidden" name="range" value="custom" /><input type="date" name="from" aria-label="From" required /><input type="date" name="to" aria-label="To" required /><button className="button secondary small">Apply</button></form>
    </div>

    <div className="metric-grid">
      <div className="metric-card"><span>New users</span><strong>{usersNew}</strong></div>
      <div className="metric-card"><span>New businesses</span><strong>{businessesNew}</strong></div>
      <div className="metric-card"><span>Reviews submitted</span><strong>{submitted}</strong></div>
      <div className="metric-card"><span>Published in range</span><strong>{published}</strong><small>{submitted ? `${Math.round((published / submitted) * 100)}% of submissions` : "—"}</small></div>
      <div className="metric-card"><span>Claims approved</span><strong>{claimByStatus["PUBLISHED"] || 0}</strong><small>{claimByStatus["REJECTED"] || 0} rejected · {claimByStatus["PENDING"] || 0} still open</small></div>
      <div className="metric-card"><span>Reports resolved</span><strong>{reportsResolved}</strong></div>
      <div className="metric-card"><span>Moderation turnaround</span><strong>{avgTurnaround === null ? "—" : `${avgTurnaround.toFixed(1)}h`}</strong><small>submission → first decision</small></div>
    </div>

    <div className="panel-grid-2">
      <section className="panel"><h3>Grade distribution (all published)</h3>
        {reviews.length === 0 ? <EmptyState title="No published reviews." description="Distribution appears once reviews exist." /> :
          <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Grade</th><th>Reviews</th><th>Share</th></tr></thead><tbody>
            {Object.entries(grades).map(([g, n]) => <tr key={g}><td>{GRADE_LABELS[g]}</td><td>{n}</td><td>{reviews.length ? `${((n / reviews.length) * 100).toFixed(1)}%` : "—"}</td></tr>)}
            <tr><td><strong>Average score</strong></td><td colSpan={2}><strong>{reviews.length ? (serviceSum / reviews.length).toFixed(1) : "—"} / 100</strong></td></tr>
            <tr><td>With support category</td><td colSpan={2}>{supportN} reviews{supportN ? ` · avg ${(supportSum / supportN).toFixed(1)}` : ""}</td></tr>
          </tbody></table>}
      </section>
      <section className="panel"><h3>Reports by category</h3>
        {reportKinds.length === 0 ? <p style={{ marginTop: 12 }}>No reports in range.</p> :
          <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Category</th><th>Reports</th></tr></thead><tbody>
            {reportKinds.map(k => <tr key={k.kind}><td>{k.kind}</td><td>{k._count._all}</td></tr>)}
          </tbody></table>}
        <h3 style={{ marginTop: 24 }}>CSV exports</h3>
        <p style={{ fontSize: 11.5 }}>Exports contain account and listing records — handle per the privacy policy. Exports are permission-checked and audited.</p>
        <div className="button-row" style={{ marginTop: 12 }}>
          { }
          <a className="button secondary small" href="/api/admin-export?kind=users" download>Users CSV</a>
          { }
          <a className="button secondary small" href="/api/admin-export?kind=reviews" download>Reviews CSV</a>
          { }
          <a className="button secondary small" href="/api/admin-export?kind=businesses" download>Businesses CSV</a>
          { }
          <a className="button secondary small" href="/api/admin-export?kind=audit" download>Audit log CSV</a>
        </div>
      </section>
    </div>
    <p className="notice" style={{ marginTop: 16 }}>Business profile views and QR scans are not tracked by the platform, so no view/scan statistics are shown.</p>
  </>;
}
