import { notFound } from "next/navigation";
import Link from "next/link";
import { db, canonicalProfile } from "@/lib/db";
import { pageUser } from "@/lib/security";
import { businessReputation, eligibleReviews, pageNumber, trendByMonth } from "@/lib/data";
import { ActionForm, BusinessFields, CopyButton } from "@/components/forms";
import { EmptyState, PageHeading, Pagination, ReputationPanel, Trend } from "@/components/shared";
import { DashboardNav } from "@/components/shell";
import { LogoUploader } from "@/components/business-logo";

export const metadata = { title: "Manage business", robots: { index: false, follow: false } };
export default async function ManageBusiness({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await pageUser();
  const business = await db().business.findUnique({ where: { id: (await params).id }, include: { members: { where: { userId: user.id } } } });
  if (!business || (user.role !== "ADMIN" && !business.members.length)) notFound();
  if (business.disabledAt) return <div className="container page-main"><PageHeading title="Business unavailable" description="This profile is disabled. QR management and profile updates are paused." /><Link className="button primary" href="/contact">Contact the team</Link></div>;
  const page = pageNumber((await searchParams).page);
  const [stats, reviews, timeline] = await Promise.all([
    businessReputation(business.id),
    db().review.findMany({ where: { businessId: business.id, ...eligibleReviews }, include: { user: { select: { displayName: true } }, reply: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 12, take: 12 }),
    db().review.findMany({ where: { businessId: business.id, ...eligibleReviews }, select: { score: true, createdAt: true } }),
  ]);
  const url = canonicalProfile(business);
  return <div className="page-main"><div className="container"><PageHeading eyebrow="BUSINESS DASHBOARD" title={business.name} description="Every customer experience is an opportunity to understand your business better." /><DashboardNav /><div className="stats-grid"><div className="stat-card"><span>Overall reputation</span><strong>{stats.grade || "Not rated"}</strong><small>{stats.grade ? `${stats.score!.toFixed(1)} / 100` : `${stats.minimum} reviews needed`}</small></div><div className="stat-card"><span>Published reviews</span><strong>{stats.count}</strong><small>Eligible for reputation</small></div><div className="stat-card"><span>Customer Support</span><strong style={{ fontSize: 23 }}>{business.supportEnabled ? "Enabled" : "Disabled"}</strong><small>Applies to new reviews</small></div></div>
    <div className="owner-layout"><div><section className="panel"><h2>Business settings</h2><Link href={`/review/${business.domain || business.slug}`} className="text-link" style={{ marginTop: 0, marginBottom: 20 }}>Open public profile ↗</Link><LogoUploader business={business} /><ActionForm action="business-update" fixed={{ businessId: business.id }} booleans={["supportEnabled"]}><BusinessFields business={business} /></ActionForm></section><section><div className="section-title"><h2>Customer reviews & responses</h2><span>{stats.count} published</span></div>{reviews.length ? reviews.map(r => <article className="owner-review" key={r.id}><div className="admin-card-head"><h3>{r.headline}</h3><span className="rating-tag">{r.score} / 100</span></div><small>{r.user.displayName} · {r.createdAt.toLocaleDateString()}</small><p>{r.body}</p>{r.reply && <p className="notice">Response status: {r.reply.status.toLowerCase()}</p>}<details><summary>{r.reply ? "Edit your business response" : "Respond to this review"}</summary><ActionForm action="reply" label="Submit response for moderation" fixed={{ reviewId: r.id }}><label className="field"><span>Your response</span><textarea name="body" defaultValue={r.reply?.body || ""} minLength={10} maxLength={2000} required rows={4} /></label><small>Your reply will not change the review’s score. Edited replies require moderation again.</small></ActionForm></details></article>) : <EmptyState title="Make room for the conversation." description="Published customer reviews will appear here. Use your QR code to invite customers to share an experience." />}<Pagination base={`/dashboard/${business.id}`} page={page} total={stats.count} /></section></div>
      <aside><section className="panel qr-panel" id="qr"><h2>My QR Code</h2><p>Scan to Review This Business</p>{
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/qr/${business.id}`} alt={`QR code for ${business.name}'s public Review Matters profile`} width={230} height={230} />
      }<a className="qr-link" href={url}>{url}</a><div className="qr-actions"><a className="button primary" href={`/api/qr/${business.id}?format=png&download=1`} download>Download PNG</a><a className="button secondary" href={`/api/qr/${business.id}?format=svg&download=1`} download>Download SVG</a><CopyButton value={url} /></div><Link href={`/dashboard/${business.id}/poster`} className="text-link">Open print-friendly poster →</Link><p style={{ marginTop: 17, fontSize: 10 }}>Your QR code uses a permanent profile URL. Changing your business name won’t change it.</p></section><ReputationPanel stats={stats} supportEnabled={business.supportEnabled} /><section className="panel"><h3>Reputation history</h3><Trend data={trendByMonth(timeline)} /></section></aside>
    </div></div></div>;
}
