import Link from "next/link";
import { panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";

const BASE = "/review-matter-panel";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await panelUser("MODERATOR");
  const q = ((await searchParams).q || "").slice(0, 100);
  const insensitive = { contains: q, mode: "insensitive" as const };
  const [users, businesses, reviews] = q ? await Promise.all([
    db().user.findMany({ where: { OR: [{ email: insensitive }, { displayName: insensitive }] }, take: 10, select: { id: true, displayName: true, email: true, role: true, disabledAt: true } }),
    db().business.findMany({ where: { OR: [{ name: insensitive }, { city: insensitive }, { category: insensitive }] }, take: 10, select: { id: true, name: true, city: true, category: true, disabledAt: true } }),
    db().review.findMany({ where: { OR: [{ headline: insensitive }, { body: insensitive }] }, take: 10, select: { id: true, headline: true, status: true, business: { select: { name: true } } } }),
  ]) : [[], [], []];

  return <>
    <div className="page-heading"><span className="eyebrow purple">GLOBAL SEARCH</span><h1>{q ? `Results for “${q}”` : "Search the platform."}</h1></div>
    {!q ? <EmptyState title="Enter a search above." description="Searches users, businesses, and review text." /> :
      <div className="panel-grid-2">
        <section className="panel"><h3>Users ({users.length})</h3>
          {users.map(u => <p key={u.id} style={{ marginTop: 10, fontSize: 12.5 }}><Link className="text-link" href={`${BASE}/users/${u.id}`}>{u.displayName}</Link> — {u.email} · {u.role}{u.disabledAt ? " · suspended" : ""}</p>)}
          {!users.length && <p style={{ marginTop: 10 }}>No matches.</p>}
        </section>
        <section className="panel"><h3>Businesses ({businesses.length})</h3>
          {businesses.map(b => <p key={b.id} style={{ marginTop: 10, fontSize: 12.5 }}><Link className="text-link" href={`${BASE}/businesses/${b.id}`}>{b.name}</Link> — {b.city}, {b.category}{b.disabledAt ? " · disabled" : ""}</p>)}
          {!businesses.length && <p style={{ marginTop: 10 }}>No matches.</p>}
        </section>
        <section className="panel" style={{ gridColumn: "1 / -1" }}><h3>Reviews ({reviews.length})</h3>
          {reviews.map(r => <p key={r.id} style={{ marginTop: 10, fontSize: 12.5 }}><Link className="text-link" href={`${BASE}/reviews/${r.id}`}>{r.headline}</Link> — {r.business.name} · <StatusPill status={r.status} /></p>)}
          {!reviews.length && <p style={{ marginTop: 10 }}>No matches.</p>}
        </section>
      </div>}
  </>;
}
