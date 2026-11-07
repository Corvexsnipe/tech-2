import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Globe, MapPin, PenLine, Tag } from "lucide-react";
import { configured, db, profileSlug } from "@/lib/db";
import { businessReputation, eligibleReviews, pageNumber, publicReviewInclude, reviewView, trendByMonth } from "@/lib/data";
import { EmptyState, Pagination, ReputationPanel, SetupNotice, Trend } from "@/components/shared";
import { ReviewCard } from "@/components/review-card";
import { BusinessLogo } from "@/components/business-logo";

async function findBusiness(slug: string) {
  return db().business.findFirst({ where: { OR: [{ slug }, { domain: slug }] }, include: { _count: { select: { members: true } } } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  if (!configured()) return { title: "Business profile" };
  const business = await findBusiness((await params).slug);
  return { title: business && !business.disabledAt ? business.name : "Business unavailable", alternates: { canonical: business ? `/review/${profileSlug(business)}` : undefined } };
}
export default async function Profile({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  if (!configured()) return <div className="container page-main"><SetupNotice /><EmptyState title="Profiles are being prepared." description="The business directory will be available after database setup." href="/explore" label="Back to the directory" /></div>;
  const { slug } = await params;
  const business = await findBusiness(slug);
  if (!business || business.disabledAt) notFound();
  // Keep one canonical profile address: /review/<domain> (or the slug when no domain exists).
  const canonical = profileSlug(business);
  if (slug !== canonical) permanentRedirect(`/review/${canonical}`);
  const page = pageNumber((await searchParams).page);
  const [stats, reviews, timeline] = await Promise.all([
    businessReputation(business.id),
    db().review.findMany({ where: { businessId: business.id, ...eligibleReviews }, include: publicReviewInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 12, skip: (page - 1) * 12 }),
    db().review.findMany({ where: { businessId: business.id, ...eligibleReviews }, select: { score: true, createdAt: true } }),
  ]);
  return <div className="page-main"><div className="container"><div className="breadcrumb"><Link href="/explore">Explore businesses</Link><ChevronRight size={13} /><span>{business.name}</span></div>
    <div className="profile-header"><div className="profile-title"><BusinessLogo business={business} /><div><h1>{business.name}</h1><p>{business.category} · {business.city}</p></div></div><Link href={`/review/${canonical}/write`} className="button primary"><PenLine size={16} /> Write a Review</Link></div>
    <div className="profile-layout"><div><p className="profile-description">{business.description}</p><div className="section-title"><h2>Customer experiences</h2><span>{stats.count} published reviews</span></div>{reviews.length ? <div className="review-list">{reviews.map(review => <ReviewCard key={review.id} review={reviewView(review)} supportEnabled={business.supportEnabled} />)}</div> : <EmptyState title="Every story starts somewhere." description="There are no published reviews here yet. Share your experience to help the next customer." href={`/review/${canonical}/write`} label="Write the first review" />}<Pagination base={`/review/${canonical}`} page={page} total={stats.count} /></div>
      <aside className="profile-sidebar"><ReputationPanel stats={stats} supportEnabled={business.supportEnabled} /><div className="panel"><h3>Good to know</h3><div className="info-list"><span><MapPin size={15} />{business.city}</span><span><Tag size={15} />{business.category}</span>{business.website && <a href={business.website} rel="nofollow noopener noreferrer" target="_blank"><Globe size={15} />Visit business website</a>}</div><p style={{ marginTop: 19, fontSize: 10 }}>Proof attachments are optional and do not guarantee authenticity.</p>{business._count.members === 0 && <Link href={`/claim?business=${business.id}`} className="text-link">Is this your business? Claim it.</Link>}</div><div className="panel"><h3>Reputation over time</h3><Trend data={trendByMonth(timeline)} /></div></aside>
    </div>
  </div></div>;
}
