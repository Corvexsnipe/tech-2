import Link from "next/link";
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, Clock3, Layers3, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { panelUser, dateRange, overviewMetrics, type Metric } from "@/lib/admin";
import { db } from "@/lib/db";
import { ELIGIBLE_REVIEW_WHERE } from "@/lib/security/review-eligibility";
import { EmptyState } from "@/components/shared";
import { ActivityChart, MetricCount, GradeChart, type ActivityPoint } from "@/components/panel-charts";

const BASE = "/review-matter-panel";
const GRADE_ORDER = ["A_PLUS", "A", "B", "C", "D"] as const;

function RangeBar({ range }: { range: { key: string; label: string } }) {
  return <div className="range-bar" aria-label="Date range">
    <CalendarDays size={16} aria-hidden="true" />
    {[["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]].map(([key, label]) =>
      <Link key={key} href={`${BASE}?range=${key}`} aria-current={range.key === key ? "page" : undefined} className={range.key === key ? "active" : ""}>{label}</Link>)}
    <form action={BASE}><input type="hidden" name="range" value="custom" /><input type="date" name="from" aria-label="From" required /><span aria-hidden="true">—</span><input type="date" name="to" aria-label="To" required /><button className="button secondary small">Apply</button></form>
    <span className="range-caption">{range.label}</span>
  </div>;
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const user = await panelUser("MODERATOR");
  const params = await searchParams;
  const range = dateRange(params.range, params.from, params.to);
  const [m, recent, activity] = await Promise.all([
    overviewMetrics(range),
    db().auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    // Aggregate in the existing database; no raw review content is sent to charts.
    db().$queryRaw<ActivityPoint[]>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS submitted,
        COUNT(*) FILTER (WHERE status::text = ${ELIGIBLE_REVIEW_WHERE.status} AND "securityState"::text = ${ELIGIBLE_REVIEW_WHERE.securityState})::int AS published
      FROM "Review" WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY day ORDER BY day`,
  ]);
  const daily = new Map(activity.map(d => [d.day, d]));
  const data: ActivityPoint[] = [];
  for (let time = range.from.getTime(); time <= range.to.getTime(); time += 86400_000) {
    const day = new Date(time).toISOString().slice(0, 10);
    data.push(daily.get(day) ?? { day, submitted: 0, published: 0 });
  }
  const primary = [
    { label: "Total users", value: m.users, hint: `${m.newUsers} joined in selected period`, href: `${BASE}/users`, Icon: Users },
    { label: "Businesses", value: m.businesses, hint: `${m.activeBusinesses} public listings`, href: `${BASE}/businesses`, Icon: Building2 },
    { label: "Total reviews", value: m.reviews, hint: `${m.publishedReviews} eligible and published`, href: `${BASE}/reviews`, Icon: MessageSquare },
    { label: "Open reports", value: m.openReports, hint: "Awaiting a moderation decision", href: `${BASE}/reports?status=PENDING`, Icon: ShieldCheck },
  ];
  const metrics: Metric[] = [
    { label: "Active users", value: m.users - m.suspended, href: `${BASE}/users?status=active` },
    { label: "Suspended", value: m.suspended, href: `${BASE}/users?status=suspended` },
    { label: "Deletion requests", value: m.deletionRequests, href: `${BASE}/users?status=deletion` },
    { label: "Pending claims", value: m.pendingClaims, href: `${BASE}/claims?status=PENDING` },
    { label: "Unclaimed listings", value: m.unclaimed, href: `${BASE}/businesses?verification=unclaimed` },
    { label: "Pending reviews", value: m.pendingReviews, href: `${BASE}/reviews?status=PENDING` },
    { label: "Reported reviews", value: m.reportedReviews, href: `${BASE}/reviews?status=reported` },
    { label: "Open appeals", value: m.appealedReviews, href: `${BASE}/reviews?status=appealed` },
    { label: "Proof queue", value: m.pendingAttachments, href: `${BASE}/attachments?status=PENDING` },
    { label: "Replies queue", value: m.pendingReplies, href: `${BASE}/reviews?status=PUBLISHED` },
    { label: "Unread messages", value: m.unresolvedMessages, href: `${BASE}/system` },
  ];
  const backlog = [
    ["Review submissions", m.pendingReviews, `${BASE}/reviews?status=PENDING`, MessageSquare],
    ["Ownership claims", m.pendingClaims, `${BASE}/claims?status=PENDING`, Building2],
    ["Reported content", m.openReports, `${BASE}/reports?status=PENDING`, ShieldCheck],
    ["Proof attachments", m.pendingAttachments, `${BASE}/attachments?status=PENDING`, Layers3],
    ["Review appeals", m.appealedReviews, `${BASE}/reviews?status=appealed`, Clock3],
    ["Deletion requests", m.deletionRequests, `${BASE}/users?status=deletion`, Users],
  ] as const;
  const pending = backlog.reduce((n, item) => n + item[1], 0);
  return <>
    <div className="overview-heading">
      <div className="page-heading"><h1>Overview</h1><p>Platform totals and moderation activity. Signed in as {user.displayName}.</p></div>
      <Link className="button secondary" href={`${BASE}/analytics`}>View analytics <ArrowUpRight size={16} /></Link>
    </div>
    <RangeBar range={range} />
    <div className="metric-grid overview-metrics">{primary.map(({ Icon, ...metric }) =>
      <Link key={metric.label} href={metric.href} className="metric-card hero-metric">
        <div className="metric-top"><span>{metric.label}</span><i className="metric-icon"><Icon size={20} /></i></div>
        <strong><MetricCount value={metric.value} /></strong><div className="metric-bottom"><small>{metric.hint}</small><ArrowUpRight size={16} /></div>
      </Link>)}</div>
    <div className="overview-chart-grid">
      <section className="panel activity-panel"><div className="panel-section-heading"><h2>Review activity</h2><span className="badge dim">{range.label}</span></div><ActivityChart data={data} /></section>
      <section className="panel"><div className="panel-section-heading"><h2>Grade distribution</h2></div><GradeChart values={GRADE_ORDER.map(grade => ({ label: grade === "A_PLUS" ? "A+" : grade, count: m.gradeDistribution.find(g => g.serviceGrade === grade)?._count._all ?? 0 }))} /><p className="chart-footnote">Service quality grades for eligible published reviews.</p></section>
    </div>
    <div className="overview-work-grid">
      <section className="panel"><div className="panel-section-heading"><h2>Priority queue</h2><span className={`badge ${pending ? "warn" : "ok"}`}>{pending} queue entries</span></div>
        <div className="priority-list">{backlog.map(([label, count, href, Icon]) => <Link key={label} href={href}><span className="queue-icon"><Icon size={17} /></span><span>{label}</span><b>{count}</b><ArrowRight size={15} /></Link>)}</div>
      </section>
      <section className="panel"><div className="panel-section-heading"><h2>Publication overview</h2></div>
        <div className="publication-score"><strong>{m.reviews ? Math.round(m.publishedReviews / m.reviews * 100) : "—"}<span>{m.reviews ? "%" : ""}</span></strong><p>of submitted reviews are<br />currently eligible and published</p></div>
        <div className="publication-track" role="meter" aria-label="Published share of all submissions" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.reviews ? Math.round(m.publishedReviews / m.reviews * 100) : 0}><span style={{ width: `${m.reviews ? m.publishedReviews / m.reviews * 100 : 0}%` }} /></div>
        <div className="publication-facts"><div><span>Eligible reviews</span><strong>{m.publishedReviews}</strong></div><div><span>Average overall score</span><strong>{m.avgScore === null ? "—" : `${m.avgScore.toFixed(1)} / 100`}</strong></div></div>
        <Link className="text-link" href={`${BASE}/security`}>Open Security Center <ArrowUpRight size={14} /></Link>
      </section>
    </div>
    <section className="panel quick-actions"><div><h2>Quick actions</h2></div><Link href={`${BASE}/reviews?status=PENDING`}><MessageSquare size={18} /> Review queue <ArrowUpRight size={15} /></Link><Link href={`${BASE}/businesses`}><Building2 size={18} /> Manage businesses <ArrowUpRight size={15} /></Link><Link href={`${BASE}/support`}><Users size={18} /> Support tickets <ArrowUpRight size={15} /></Link></section>
    <div className="panel-section-heading operations-heading"><h2>Operations</h2><span className="range-caption">Current platform totals</span></div>
    <div className="metric-grid operations-metrics">{metrics.map(metric => <Link key={metric.label} href={metric.href} className="metric-card"><span>{metric.label}</span><strong>{metric.value}</strong><ArrowUpRight size={15} /></Link>)}</div>
    <section className="panel recent-activity"><div className="panel-section-heading"><h2>Recent activity</h2><Link className="text-link" href={`${BASE}/audit`}>View audit log <ArrowUpRight size={14} /></Link></div>
      {recent.length === 0 ? <EmptyState title="No activity yet" description="Administrative actions will appear here." /> : recent.map(log =>
        <div className="audit-row" key={log.id}><span className="activity-marker"><Clock3 size={15} /></span><div><strong>{log.action.replaceAll("-", " ")}</strong><p>{log.detail}</p><small>Actor: {log.actorId || "system"} · Record: {log.targetId}</small></div><time dateTime={log.createdAt.toISOString()}>{log.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</time></div>)}
    </section>
  </>;
}
