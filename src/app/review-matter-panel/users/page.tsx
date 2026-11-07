import Link from "next/link";
import { Prisma } from "@prisma/client";
import { hasRole, panelUser, userSort } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { BulkActionForm } from "@/components/forms";
import { EmptyState, Pagination } from "@/components/shared";

const BASE = "/review-matter-panel/users";
const STATUS_FILTERS = [["all", "All"], ["active", "Active"], ["suspended", "Suspended"], ["unverified", "Unverified"], ["deletion", "Deletion requests"], ["staff", "Staff"]] as const;

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; sort?: string; page?: string }> }) {
  const me = await panelUser("MODERATOR");
  const params = await searchParams;
  const q = (params.q || "").slice(0, 100), status = params.status || "all", page = pageNumber(params.page);
  const take = 20, skip = (page - 1) * take;
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }] } : {}),
    ...(status === "active" ? { disabledAt: null } : status === "suspended" ? { disabledAt: { not: null } } :
      status === "unverified" ? { verifiedAt: null } : status === "deletion" ? { deletionRequestedAt: { not: null } } :
      status === "staff" ? { role: { in: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] } } : {}),
  };
  const [users, count] = await Promise.all([
    db().user.findMany({ where, orderBy: userSort(params.sort), take, skip,
      select: { id: true, displayName: true, email: true, role: true, verifiedAt: true, disabledAt: true, deletionRequestedAt: true, createdAt: true, _count: { select: { reviews: true } }, sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } }),
    db().user.count({ where }),
  ]);
  const canManage = hasRole(me, "ADMIN");

  return <>
    <div className="page-heading"><span className="eyebrow purple">USERS & ROLES</span><h1>Accounts.</h1><p>{count} users match this view. Suspension revokes all sessions immediately.</p></div>
    <div className="panel-tabs">{STATUS_FILTERS.map(([key, label]) => <Link key={key} href={`${BASE}?status=${key}&q=${encodeURIComponent(q)}&sort=${params.sort || "newest"}`} className={status === key ? "active" : ""}>{label}</Link>)}</div>
    <div className="panel-toolbar">
      <form className="search-bar" style={{ gridTemplateColumns: "1fr auto auto", margin: 0 }} action={BASE}>
        <input type="hidden" name="status" value={status} />
        <input name="q" aria-label="Search users" defaultValue={q} placeholder="Search name or email…" maxLength={100} />
        <select name="sort" defaultValue={params.sort || "newest"} aria-label="Sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option><option value="email">Email</option></select>
        <button className="button primary">Search</button>
      </form>
      { }
      {canManage && <a className="button secondary small" href="/api/admin-export?kind=users" download>Export CSV</a>}
    </div>

    {count === 0 ? <EmptyState title="No users match." description="Adjust the search or filters." /> :
      <BulkActionForm action="admin-users-bulk" confirm="Apply this action to every selected account? Sessions are revoked on suspension.">
        <table className="data-table"><thead><tr>
          <th><span className="sr-only">Select</span></th><th>User</th><th>Role</th><th>Status</th><th>Reviews</th><th>Last session</th><th>Joined</th><th></th>
        </tr></thead><tbody>
          {users.map(u => <tr key={u.id}>
            <td><input type="checkbox" name="ids" value={u.id} aria-label={`Select ${u.displayName}`} disabled={!canManage || u.role === "SUPER_ADMIN" || u.id === me.id} /></td>
            <td><strong>{u.displayName}</strong><br /><small style={{ color: "var(--muted)" }}>{u.email}</small></td>
            <td><span className="badge">{u.role.replace("_", " ")}</span></td>
            <td>{u.disabledAt ? <span className="badge err">Suspended</span> : u.deletionRequestedAt ? <span className="badge warn">Deletion requested</span> : u.verifiedAt ? <span className="badge ok">Verified</span> : <span className="badge warn">Unverified</span>}</td>
            <td>{u._count.reviews}</td>
            <td><small>{u.sessions[0] ? u.sessions[0].createdAt.toLocaleDateString() : "—"}</small></td>
            <td><small>{u.createdAt.toLocaleDateString()}</small></td>
            <td><Link className="text-link" href={`${BASE}/${u.id}`}>Manage →</Link></td>
          </tr>)}
        </tbody></table>
      </BulkActionForm>}
    <Pagination base={BASE} query={{ q, status, sort: params.sort || "newest" }} page={page} total={count} pageSize={take} />
  </>;
}
