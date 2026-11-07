import Link from "next/link";
import { Prisma } from "@prisma/client";
import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { eligibleReviews, pageNumber } from "@/lib/data";
import { ActionForm, BusinessFields } from "@/components/forms";
import { EmptyState, Pagination } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";

const BASE = "/review-matter-panel/businesses";
const V_FILTERS = [["all", "All"], ["verified", "Verified"], ["claim-pending", "Claim pending"], ["unclaimed", "Unclaimed"], ["disabled", "Disabled"]] as const;

export default async function Businesses({ searchParams }: { searchParams: Promise<{ q?: string; verification?: string; page?: string }> }) {
  const me = await panelUser("MODERATOR");
  const params = await searchParams;
  const q = (params.q || "").slice(0, 100), verification = params.verification || "all", page = pageNumber(params.page);
  const take = 20, skip = (page - 1) * take;
  const where: Prisma.BusinessWhereInput = {
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    ...(verification === "verified" ? { members: { some: {} }, disabledAt: null } :
      verification === "claim-pending" ? { claims: { some: { status: "PENDING" } } } :
      verification === "unclaimed" ? { members: { none: {} }, claims: { none: { status: "PUBLISHED" } }, disabledAt: null } :
      verification === "disabled" ? { disabledAt: { not: null } } : {}),
  };
  const [businesses, count] = await Promise.all([
    db().business.findMany({ where, orderBy: { createdAt: "desc" }, take, skip, include: {
      members: { include: { user: { select: { displayName: true } } } },
      claims: { where: { status: "PENDING" }, select: { id: true } },
      _count: { select: { reviews: { where: eligibleReviews } } },
    } }),
    db().business.count({ where }),
  ]);
  const canAdmin = hasRole(me, "ADMIN");

  return <>
    <div className="page-heading"><span className="eyebrow purple">BUSINESSES</span><h1>Listings.</h1><p>{count} businesses. Verification is only granted through an approved ownership claim.</p></div>
    <div className="panel-tabs">{V_FILTERS.map(([key, label]) => <Link key={key} href={`${BASE}?verification=${key}&q=${encodeURIComponent(q)}`} className={verification === key ? "active" : ""}>{label}</Link>)}</div>
    <div className="panel-toolbar">
      <form className="search-bar" style={{ gridTemplateColumns: "1fr auto", margin: 0 }} action={BASE}>
        <input type="hidden" name="verification" value={verification} />
        <input name="q" aria-label="Search businesses" defaultValue={q} placeholder="Search business name…" maxLength={100} />
        <button className="button primary">Search</button>
      </form>
      { }
      <a className="button secondary small" href="/api/admin-export?kind=businesses" download>Export CSV</a>
    </div>

    {canAdmin && <details className="panel" style={{ marginBottom: 16 }}><summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Create a business listing</summary>
      <div style={{ marginTop: 16 }}><ActionForm action="admin-business-create" label="Create listing" booleans={["supportEnabled"]}><BusinessFields /></ActionForm></div>
    </details>}

    {count === 0 ? <EmptyState title="No businesses match." description="Adjust the filters or create a listing above." /> :
      <table className="data-table"><thead><tr><th>Business</th><th>Verification</th><th>Owners</th><th>Published</th><th>Created</th><th></th></tr></thead><tbody>
        {businesses.map(b => <tr key={b.id}>
          <td><strong>{b.name}</strong><br /><small style={{ color: "var(--muted)" }}>{b.city} · {b.category}</small></td>
          <td>{b.disabledAt ? <StatusPill status="REMOVED" /> : b.members.length ? <span className="badge ok">Verified</span> : b.claims.length ? <span className="badge warn">Claim pending</span> : <span className="badge dim">Unclaimed</span>}</td>
          <td><small>{b.members.map(m => m.user.displayName).join(", ") || "—"}</small></td>
          <td>{b._count.reviews}</td>
          <td><small>{b.createdAt.toLocaleDateString()}</small></td>
          <td><Link className="text-link" href={`${BASE}/${b.id}`}>Manage →</Link></td>
        </tr>)}
      </tbody></table>}
    <Pagination base={BASE} query={{ q, verification }} page={page} total={count} pageSize={take} />
  </>;
}
