import Link from "next/link";
import { Status } from "@prisma/client";
import { panelUser, staffList, REPORT_KIND_LABELS, REPORT_KINDS } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber, publicReviewInclude, reviewView } from "@/lib/data";
import { ActionForm, Field } from "@/components/forms";
import { EmptyState, Pagination } from "@/components/shared";
import { AssignControl, StatusPill } from "@/components/admin-blocks";
import { ProofViewer, ReviewCard } from "@/components/review-card";

const BASE = "/review-matter-panel/reports";
const TABS: [Status, string][] = [["PENDING", "Open"], ["PUBLISHED", "Resolved"], ["REJECTED", "Dismissed"]];

export default async function Reports({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; page?: string }> }) {
  await panelUser("MODERATOR");
  const params = await searchParams;
  const status: Status = TABS.some(([s]) => s === params.status) ? params.status as Status : "PENDING";
  const kind = REPORT_KINDS.includes(params.kind as never) ? params.kind! : "";
  const page = pageNumber(params.page), take = 15, skip = (page - 1) * take;
  const where = { status, ...(kind ? { kind } : {}) };
  const [reports, count, staff] = await Promise.all([
    db().report.findMany({ where, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take, skip, include: {
      user: { select: { id: true, displayName: true, email: true } },
      assignee: { select: { id: true, displayName: true } },
    } }),
    db().report.count({ where }),
    staffList(),
  ]);
  const reviews = await db().review.findMany({ where: { id: { in: reports.filter(r => r.targetType === "review").map(r => r.targetId) } }, include: publicReviewInclude });
  const reviewById = new Map(reviews.map(r => [r.id, r]));

  return <>
    <div className="page-heading"><span className="eyebrow purple">REPORTS & DISPUTES</span><h1>Flagged content.</h1><p>Resolving a report does not change the content’s publication status — record a content decision separately when needed.</p></div>
    <div className="panel-tabs">{TABS.map(([s, label]) => <Link key={s} href={`${BASE}?status=${s}&kind=${kind}`} className={status === s ? "active" : ""}>{label}</Link>)}</div>
    <form className="search-bar" style={{ gridTemplateColumns: "1fr auto" }} action={BASE}>
      <input type="hidden" name="status" value={status} />
      <select name="kind" defaultValue={kind} aria-label="Report category"><option value="">All categories</option>{REPORT_KINDS.map(k => <option key={k} value={k}>{REPORT_KIND_LABELS[k]}</option>)}</select>
      <button className="button primary">Filter</button>
    </form>
    {count === 0 ? <EmptyState title="No reports here." description="Reports filed by users will appear in this queue." /> :
      await Promise.all(reports.map(async r => {
        const review = reviewById.get(r.targetId);
        const reply = r.targetType === "reply" ? await db().reply.findUnique({ where: { id: r.targetId }, include: { review: { select: { headline: true } } } }) : null;
        return <article className="admin-card" key={r.id}>
          <div className="admin-card-head"><h3>{REPORT_KIND_LABELS[r.kind] || r.kind}</h3><div><StatusPill status={r.status} />{r.priority > 0 && <span className="badge err" style={{ marginLeft: 6 }}>Priority {r.priority}</span>}</div></div>
          <small>Reported {r.targetType} · by <Link className="text-link" href={`/review-matter-panel/users/${r.user.id}`}>{r.user.displayName}</Link> · {r.createdAt.toLocaleDateString()}</small>
          <p style={{ marginTop: 10 }}>{r.reason}</p>
          {review && <div style={{ marginTop: 12 }}><ReviewCard review={reviewView(review)} /><p style={{ marginTop: 6 }}><Link className="text-link" href={`/review-matter-panel/reviews/${review.id}`}>Open review record →</Link></p></div>}
          {reply && <div className="business-reply" style={{ marginTop: 12 }}><strong>Response to “{reply.review.headline}”</strong><p>{reply.body}</p></div>}
          {r.targetType === "attachment" && <div style={{ marginTop: 12 }}><ProofViewer attachments={[{ id: r.targetId, label: "Reported evidence" }]} /></div>}
          {r.assignee && <p style={{ fontSize: 11.5, marginTop: 8 }}>Assigned to {r.assignee.displayName}</p>}
          {r.resolution && <p className="notice" style={{ marginTop: 8 }}>Resolution: {r.resolution}</p>}
          {r.status === "PENDING" && <>
            <AssignControl action="admin-report-assign" id={r.id} staff={staff} current={r.assigneeId} />
            <ActionForm action="admin-report" fixed={{ id: r.id }} numbers={["priority"]} label="Resolve report" confirm="Record this resolution?">
              <label className="field"><span>Outcome</span><select name="outcome" defaultValue="PUBLISHED"><option value="PUBLISHED">Resolve — actioned</option><option value="REJECTED">Dismiss — no violation</option></select></label>
              <Field label="Resolution reason" name="reason" minLength={10} maxLength={1000} />
              <Field label="Priority (0–3)" name="priority" type="number" required={false} defaultValue={r.priority} />
            </ActionForm>
            <details style={{ marginTop: 10 }}><summary className="text-link" style={{ cursor: "pointer" }}>Moderate the reported content</summary>
              <ActionForm action="admin-moderate" fixed={{ id: r.targetId, type: r.targetType }} label="Record content decision" confirm="Change the publication status of this content?">
                <label className="field"><span>Decision</span><select name="status" defaultValue="REJECTED"><option value="PUBLISHED">Publish</option><option value="REJECTED">Reject</option><option value="HIDDEN">Hide</option><option value="REMOVED">Remove</option></select></label>
                <Field label="Reason" name="reason" minLength={10} maxLength={1000} />
              </ActionForm>
            </details>
          </>}
        </article>;
      }))}
    <Pagination base={BASE} query={{ status, kind }} page={page} total={count} pageSize={take} />
  </>;
}
