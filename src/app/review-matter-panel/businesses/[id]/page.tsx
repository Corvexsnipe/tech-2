import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { businessReputation, eligibleReviews, trendByMonth } from "@/lib/data";
import { ActionForm, BusinessFields, Field } from "@/components/forms";
import { AdminNotes, StatusPill } from "@/components/admin-blocks";
import { ReputationPanel, Trend } from "@/components/shared";
import { GRADE_LABELS } from "@/lib/grades";

const BASE = "/review-matter-panel/businesses";

export default async function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await panelUser("MODERATOR");
  const { id } = await params;
  const business = await db().business.findUnique({ where: { id }, include: {
    members: { include: { user: { select: { id: true, displayName: true, email: true, verifiedAt: true } } } },
    claims: { orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { displayName: true, email: true } } } },
    reviews: { orderBy: { createdAt: "desc" }, take: 40, include: { user: { select: { displayName: true } } } },
  } });
  if (!business) notFound();
  const [stats, publishedForTrend, duplicates] = await Promise.all([
    businessReputation(business.id),
    db().review.findMany({ where: { businessId: id, ...eligibleReviews }, select: { score: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 500 }),
    db().business.findMany({ where: { id: { not: id }, category: business.category, OR: [{ city: { equals: business.city, mode: "insensitive" } }, { name: { contains: business.name.split(" ")[0], mode: "insensitive" } }] }, select: { id: true, name: true, city: true, disabledAt: true }, take: 6 }),
  ]);
  const canAdmin = hasRole(me, "ADMIN");
  const verification = business.disabledAt ? "Disabled" : business.members.length ? "Verified" : business.claims.some(c => c.status === "PENDING") ? "Claim pending" : business.claims.some(c => c.status === "REJECTED") ? "Claim rejected" : "Unclaimed";

  return <>
    <div className="page-heading"><span className="eyebrow purple">BUSINESS RECORD</span><h1>{business.name}</h1><p>{business.city} · {business.category} · <Link className="text-link" href={`/review/${business.domain || business.slug}`}>Public profile ↗</Link></p></div>

    <div className="panel-grid-2">
      <section className="panel"><h3>Listing details</h3>
        <table className="data-table" style={{ marginTop: 12 }}><tbody>
          <tr><td>Verification</td><td>{verification === "Verified" ? <span className="badge ok">Verified</span> : verification === "Disabled" ? <StatusPill status="REMOVED" /> : <span className="badge warn">{verification}</span>}</td></tr>
          <tr><td>Slug</td><td><code style={{ fontSize: 11 }}>{business.slug}</code></td></tr>
          <tr><td>Website</td><td>{business.website ? <a className="text-link" href={business.website} target="_blank" rel="noopener noreferrer">{business.website}</a> : "—"}</td></tr>
          <tr><td>Support category</td><td>{business.supportEnabled ? "Enabled" : "Disabled"}</td></tr>
          <tr><td>QR assets</td><td><Link className="text-link" href={`/dashboard/${business.id}/poster`}>Poster</Link> · <a className="text-link" href={`/api/qr/${business.id}?format=png`}>PNG</a> · <a className="text-link" href={`/api/qr/${business.id}?format=svg`}>SVG</a></td></tr>
        </tbody></table>
        {canAdmin && <>
          <div style={{ marginTop: 18 }}><ActionForm action="admin-business-edit" fixed={{ id: business.id }} booleans={["supportEnabled"]} label="Save listing changes"><BusinessFields business={business} /></ActionForm></div>
          <ActionForm action="admin-business" fixed={{ id: business.id, disabled: !business.disabledAt }} label={business.disabledAt ? "Restore listing" : "Disable listing"} confirm={business.disabledAt ? "Make this business public again?" : "Hide this business from the public directory? Reviews are retained."}>
            <Field label="Reason" name="reason" minLength={10} maxLength={1000} />
          </ActionForm>
        </>}
      </section>

      <section className="panel"><h3>Owners</h3>
        {business.members.length === 0 ? <p style={{ marginTop: 12 }}>No verified owners. Access is granted only by approving a claim.</p> :
          business.members.map(m => <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div><strong style={{ fontSize: 13 }}>{m.user.displayName}</strong><br /><small style={{ color: "var(--muted)" }}>{m.user.email} · {m.user.verifiedAt ? "verified" : "unverified"}</small></div>
            {canAdmin && <ActionForm action="admin-member" fixed={{ businessId: business.id, userId: m.userId, remove: true }} label="Remove" confirm="Remove this owner’s management access?" />}
          </div>)}
        {canAdmin && business.members.length > 0 && <ActionForm action="admin-domain-proof" fixed={{ businessId: business.id }} label="Provide domain proof" className="inline-action" confirm="Email every owner a domain-verification code? Use when a report disputes ownership." />}
        {canAdmin && <ActionForm action="admin-member" fixed={{ businessId: business.id, remove: false }} label="Assign owner" confirm="Grant this account full business dashboard access?">
          <Field label="Owner account email" name="email" type="email" maxLength={254} hint="The account must exist and have a verified email. Claims are the preferred verification path." />
        </ActionForm>}
        <h3 style={{ marginTop: 24 }}>Claim history</h3>
        {business.claims.length === 0 ? <p>No claims filed.</p> : business.claims.map(c =>
          <p key={c.id} style={{ marginTop: 8, fontSize: 12 }}>{c.user.displayName} ({c.user.email}) — <StatusPill status={c.status} /> <small>{c.createdAt.toLocaleDateString()}</small>{(c.status === "PENDING" || c.status === "INFO_REQUESTED") && <> <Link className="text-link" href="/review-matter-panel/claims">Decide in claims queue →</Link></>}{c.decision && <><br /><small>{c.decision}</small></>}</p>)}
      </section>
    </div>

    <div className="panel-grid-2" style={{ marginTop: 16 }}>
      <ReputationPanel stats={stats} supportEnabled={business.supportEnabled} />
      <section className="panel"><h3>Reputation trend</h3><Trend data={trendByMonth(publishedForTrend)} /></section>
    </div>

    {duplicates.length > 0 && <section className="panel" style={{ marginTop: 16 }}><h3>Possible duplicate listings</h3>
      <p style={{ fontSize: 11.5 }}>Businesses sharing the name or city/category. Review before merging; merges are not automatic.</p>
      {duplicates.map(d => <p key={d.id} style={{ marginTop: 8, fontSize: 12.5 }}><Link className="text-link" href={`${BASE}/${d.id}`}>{d.name}</Link> — {d.city} {d.disabledAt && <span className="badge err">disabled</span>}</p>)}
    </section>}

    <section className="panel" style={{ marginTop: 16 }}><h3>Reviews ({business.reviews.length} recent)</h3>
      {business.reviews.length === 0 ? <p style={{ marginTop: 12 }}>No reviews yet.</p> :
        <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Reviewer</th><th>Headline</th><th>Grades</th><th>Score</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>
          {business.reviews.map(r => <tr key={r.id}>
            <td>{r.user.displayName}</td><td>{r.headline}</td>
            <td>{GRADE_LABELS[r.serviceGrade]}{r.supportSnapshot && r.supportGrade ? ` / ${GRADE_LABELS[r.supportGrade]}` : ""}</td>
            <td>{r.score.toFixed(1)}</td><td><StatusPill status={r.status} />{r.appealedAt && <span className="badge warn" style={{ marginLeft: 4 }}>appealed</span>}</td>
            <td><small>{r.createdAt.toLocaleDateString()}</small></td>
            <td><Link className="text-link" href={`/review-matter-panel/reviews/${r.id}`}>Open →</Link></td>
          </tr>)}
        </tbody></table>}
    </section>
    <div style={{ marginTop: 16 }}><AdminNotes targetType="business" targetId={business.id} /></div>
    <p style={{ marginTop: 18 }}><Link className="text-link" href={BASE}>← Back to businesses</Link></p>
  </>;
}
