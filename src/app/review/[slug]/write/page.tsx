import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { db, profileSlug } from "@/lib/db";
import { pageUser } from "@/lib/security";
import { PageHeading } from "@/components/shared";
import { ReviewForm } from "@/components/review-form";

export const metadata = { title: "Write a review", robots: { index: false, follow: false } };
export default async function WriteReview({ params }: { params: Promise<{ slug: string }> }) {
  const user = await pageUser();
  const business = await db().business.findFirst({ where: { OR: [{ slug: (await params).slug }, { domain: (await params).slug }] }, include: { members: { where: { userId: user.id } } } });
  if (!business || business.disabledAt) notFound();
  const canonical = profileSlug(business);
  if ((await params).slug !== canonical) permanentRedirect(`/review/${canonical}/write`);
  const existing = await db().review.findFirst({ where: { businessId: business.id, userId: user.id, activeKey: { not: null } } });
  return <div className="page-main"><div className="container narrow"><div className="breadcrumb"><Link href={`/review/${canonical}`}>← Back to {business.name}</Link></div><PageHeading eyebrow="YOUR EXPERIENCE CAN HELP SOMEONE ELSE" title={`Review ${business.name}`} description="Be honest. Be specific. Give the next customer a little more perspective." />
    {!user.verifiedAt ? <div className="notice warning">Please <Link href="/resend-verification">verify your email</Link> before reviewing a business.</div> : existing ? <div className="notice">You already have an active review for this business. <Link href="/account">View its status in your account.</Link></div> : business.members.length ? <div className="notice">You cannot review a business you manage.</div> : <div className="panel"><ReviewForm businessId={business.id} supportEnabled={business.supportEnabled} /></div>}
  </div></div>;
}
