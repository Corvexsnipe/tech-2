import Link from "next/link";
import { pageUser } from "@/lib/security";
import { db } from "@/lib/db";
import { pageNumber, publicReviewInclude, reviewView } from "@/lib/data";
import { ActionForm } from "@/components/forms";
import { DashboardNav } from "@/components/shell";
import { EmptyState, PageHeading, Pagination } from "@/components/shared";
import { ReviewCard } from "@/components/review-card";

export const metadata = { title: "My account", robots: { index: false, follow: false } };
export default async function Account({ searchParams }: { searchParams: Promise<{ page?: string; submitted?: string }> }) {
  const user = await pageUser();
  const query = await searchParams, page = pageNumber(query.page);
  const [reviews, total, notifications] = await Promise.all([
    db().review.findMany({ where: { userId: user.id }, include: { ...publicReviewInclude, attachments: { where: { status: { not: "REMOVED" } }, select: { id: true, label: true } }, business: { select: { name: true, slug: true, domain: true, supportEnabled: true } } }, orderBy: { createdAt: "desc" }, take: 12, skip: (page - 1) * 12 }),
    db().review.count({ where: { userId: user.id } }), db().notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return <div className="page-main"><div className="container"><PageHeading eyebrow="YOUR PERSPECTIVE, IN ONE PLACE" title={`Hello, ${user.displayName}.`} description="Keep track of your experiences, review status, and conversations." /><DashboardNav />
    {!user.verifiedAt && <div className="notice warning">Your email is not verified yet. <Link href="/resend-verification">Send a verification link</Link> to start reviewing and claiming businesses.</div>}
    {query.submitted && <div className="notice success" role="status">{query.submitted === "pending" ? "Your review was submitted successfully. It will appear on the business profile once our team approves it — we will notify you." : "Your review was submitted successfully. It is now published on the business profile."}</div>}
    <div className="dashboard-grid"><section><div className="section-title" style={{ marginTop: 0 }}><h2>My reviews</h2><span>{total} submitted</span></div>{reviews.length ? reviews.map(review => <div key={review.id} className="account-review"><div className="account-review-heading"><Link href={`/review/${review.business.domain || review.business.slug}`}>{review.business.name}</Link><span className={`status-pill status-${review.status.toLowerCase()}`}>{review.status}</span></div><ReviewCard review={reviewView(review)} supportEnabled={review.business.supportEnabled} />{review.moderationNote && <p className="notice">{review.moderationNote}</p>}{review.status !== "REMOVED" && <ActionForm action="review-withdraw" fixed={{ id: review.id }} label="Withdraw review" confirm="Withdraw this review and its evidence from public display?" />}{["REJECTED", "REMOVED", "HIDDEN"].includes(review.status) && !review.appealedAt && <details style={{ marginTop: 10 }}><summary className="text-link" style={{ cursor: "pointer" }}>Appeal this decision</summary><ActionForm action="review-appeal" fixed={{ id: review.id }} label="Submit appeal"><label className="field"><span>Why should a moderator take another look?</span><textarea name="reason" required minLength={10} maxLength={2000} rows={3} /></label></ActionForm></details>}{review.appealedAt && <p className="notice" role="status">Your appeal is awaiting a second review by staff.</p>}</div>) : <EmptyState title="Your first experience belongs here." description="Find a business you’ve used and share what you learned." href="/explore" label="Find a business" />}<Pagination base="/account" page={page} total={total} /></section>
      <aside className="panel"><h2>Notifications</h2><p>Review updates, replies, and account activity.</p><div className="notifications">{notifications.length ? notifications.map(n => <Link key={n.id} href={n.href} className={`notification ${n.readAt ? "" : "unread"}`}><p>{n.message}</p><time>{n.createdAt.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</time></Link>) : <p style={{ marginTop: 20, fontSize: 12 }}>You’re all caught up. New updates will appear here.</p>}{notifications.some(n => !n.readAt) && <ActionForm action="notifications-read" label="Mark all as read" />}</div></aside>
    </div>
  </div></div>;
}
