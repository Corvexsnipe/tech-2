import Link from "next/link";
import { Prisma, Status } from "@prisma/client";
import { panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { EmptyState, Pagination } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";
import { SecurityStatePill } from "@/components/security-blocks";
import { GRADE_LABELS } from "@/lib/grades";

const BASE = "/review-matter-panel/reviews";
const TABS = [["PENDING", "Pending"], ["PUBLISHED", "Published"], ["REJECTED", "Rejected"], ["HIDDEN", "Hidden"], ["reported", "Reported"], ["appealed", "Appealed"], ["REMOVED", "Removed"]] as const;

export default async function Reviews({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; q?: string }> }) {
  await panelUser("MODERATOR");
  const params = await searchParams;
  const tab = TABS.some(([s]) => s === params.status) ? params.status! : "PENDING";
  const q = (params.q || "").slice(0, 100);
  const page = pageNumber(params.page), take = 15, skip = (page - 1) * take;
  const where: Prisma.ReviewWhereInput = {
    ...(tab === "appealed" ? { appealedAt: { not: null } } : tab === "reported" ? {} : { status: tab as Status }),
    ...(q ? { OR: [{ headline: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { business: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  if (tab === "reported") {
    const targets = await db().report.findMany({ where: { status: "PENDING", targetType: "review" }, select: { targetId: true }, distinct: ["targetId"] });
    where.id = { in: targets.map(t => t.targetId) };
  }
  const [reviews, count] = await Promise.all([
    db().review.findMany({ where, orderBy: { createdAt: "asc" }, take, skip, include: {
      business: { select: { name: true, slug: true } },
      user: { select: { displayName: true, email: true } },
      assignee: { select: { displayName: true } },
    } }),
    db().review.count({ where }),
  ]);

  return <>
    <div className="page-heading"><span className="eyebrow purple">REVIEW MODERATION</span><h1>Every review, accounted for.</h1><p>Negative reviews are never removed for being negative. Decisions require a reason and are recorded permanently.</p></div>
    <div className="panel-tabs">{TABS.map(([s, label]) => <Link key={s} href={`${BASE}?status=${s}&q=${encodeURIComponent(q)}`} className={tab === s ? "active" : ""}>{label}</Link>)}</div>
    <form className="search-bar" style={{ gridTemplateColumns: "1fr auto" }} action={BASE}>
      <input type="hidden" name="status" value={tab} />
      <input name="q" aria-label="Search reviews" defaultValue={q} placeholder="Search headline, text, or business…" maxLength={100} />
      <button className="button primary">Search</button>
    </form>
    {count === 0 ? <EmptyState title="Nothing in this queue." description="Reviews matching this filter appear here." /> :
      <table className="data-table"><thead><tr><th>Review</th><th>Business</th><th>Grades</th><th>Score</th><th>Status</th><th>Filed</th><th>Assigned</th><th></th></tr></thead><tbody>
        {reviews.map(r => <tr key={r.id}>
          <td><strong>{r.headline}</strong><br /><small style={{ color: "var(--muted)" }}>{r.user.displayName} · {r.user.email}</small></td>
          <td>{r.business.name}</td>
          <td>{GRADE_LABELS[r.serviceGrade]}{r.supportSnapshot && r.supportGrade ? ` / ${GRADE_LABELS[r.supportGrade]}` : ""}</td>
          <td>{r.score.toFixed(1)}</td>
          <td><StatusPill status={r.status} />{r.appealedAt && <span className="badge warn" style={{ marginLeft: 4 }}>appealed</span>}<br /><small style={{ marginTop: 4, display: "inline-block" }}><SecurityStatePill state={r.securityState} /></small></td>
          <td><small>{r.createdAt.toLocaleDateString()}</small></td>
          <td><small>{r.assignee?.displayName || "—"}</small></td>
          <td><Link className="text-link" href={`${BASE}/${r.id}`}>Moderate →</Link></td>
        </tr>)}
      </tbody></table>}
    <Pagination base={BASE} query={{ status: tab, q }} page={page} total={count} pageSize={take} />
  </>;
}
