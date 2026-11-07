import { Prisma } from "@prisma/client";
import { configured, db } from "./db";
import { DEFAULT_MINIMUM_REVIEWS, POINTS, fromDbGrade, gradeFor } from "./grades";
import { ELIGIBLE_REVIEW_WHERE } from "./security/review-eligibility";
import type { ReviewView } from "@/components/review-card";

// Every public listing and aggregate filters on this: published AND cleared
// by network security verification.
export const eligibleReviews = ELIGIBLE_REVIEW_WHERE;

export const publicReviewInclude = {
  user: { select: { displayName: true } },
  attachments: { where: { status: "PUBLISHED" as const }, select: { id: true, label: true } },
  reply: { select: { id: true, body: true, status: true } },
} satisfies Prisma.ReviewInclude;

type PublicReview = Prisma.ReviewGetPayload<{ include: typeof publicReviewInclude }>;
export function reviewView(review: PublicReview): ReviewView {
  return {
    id: review.id, headline: review.headline, body: review.body, score: review.score,
    serviceGrade: fromDbGrade(review.serviceGrade), supportGrade: review.supportGrade ? fromDbGrade(review.supportGrade) : null,
    supportSnapshot: review.supportSnapshot, date: review.createdAt.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }),
    author: review.user.displayName, attachments: review.attachments,
    reply: review.reply?.status === "PUBLISHED" ? review.reply : null,
  };
}
export async function minimumReviews() {
  if (!configured()) return DEFAULT_MINIMUM_REVIEWS;
  return (await db().platformConfig.findUnique({ where: { id: "platform" } }))?.minimumReviews ?? DEFAULT_MINIMUM_REVIEWS;
}
export async function businessReputation(businessId: string, minimum?: number) {
  const groups = await db().review.groupBy({
    by: ["serviceGrade", "supportGrade"], where: { businessId, ...ELIGIBLE_REVIEW_WHERE },
    _count: { _all: true }, _avg: { score: true },
  });
  let count = 0, total = 0, serviceTotal = 0, supportTotal = 0, supportCount = 0;
  for (const group of groups) {
    const n = group._count._all;
    count += n;
    total += (group._avg.score || 0) * n;
    serviceTotal += POINTS[fromDbGrade(group.serviceGrade)] * n;
    if (group.supportGrade) { supportTotal += POINTS[fromDbGrade(group.supportGrade)] * n; supportCount += n; }
  }
  const threshold = minimum ?? await minimumReviews();
  const score = count ? total / count : null;
  return { count, score, service: count ? serviceTotal / count : null, support: supportCount ? supportTotal / supportCount : null, grade: count >= threshold && score !== null ? gradeFor(score) : null, minimum: threshold };
}
export const pageNumber = (input?: string) => Math.min(10000, Math.max(1, Math.floor(Number(input) || 1)));
export function trendByMonth(reviews: { score: number; createdAt: Date }[]) {
  const months = new Map<string, { score: number; count: number }>();
  for (const review of reviews) {
    const month = review.createdAt.toISOString().slice(0, 7);
    const bucket = months.get(month) || { score: 0, count: 0 };
    bucket.score += review.score; bucket.count++;
    months.set(month, bucket);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, value]) => ({ month, score: value.score / value.count, count: value.count }));
}
