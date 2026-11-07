import { Prisma, Role } from "@prisma/client";
import { AppError, db } from "./db";
import { redirect } from "next/navigation";
import { currentUser } from "./security";
import { ELIGIBLE_REVIEW_WHERE } from "./security/review-eligibility";

export const STAFF_ROLES: Role[] = ["MODERATOR", "ADMIN", "SUPER_ADMIN"];
const RANK: Record<Role, number> = { CUSTOMER: 0, MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };
export const isStaff = (user: { role: Role } | null | undefined) => !!user && RANK[user.role] >= 1;
export const hasRole = (user: { role: Role }, minimum: Role) => RANK[user.role] >= RANK[minimum];
export function requireRole(user: { role: Role }, minimum: Role) {
  if (RANK[user.role] < RANK[minimum]) throw new AppError("Your role does not permit this action.", 403);
}

/** Server-component guard for every /review-matter-panel page. */
export async function panelUser(minimum: Role = "MODERATOR") {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!isStaff(user)) redirect("/account");
  if (!user.verifiedAt || user.disabledAt) redirect("/account");
  requireRole(user, minimum);
  return user;
}

export interface Range { key: string; from: Date; to: Date; label: string }
export function dateRange(range: string | undefined, from: string | undefined, to: string | undefined): Range {
  const toDate = new Date();
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (range === "custom" && from && to) {
    const f = new Date(`${from}T00:00:00Z`), t = new Date(`${to}T23:59:59.999Z`);
    if (!isNaN(f.getTime()) && !isNaN(t.getTime()) && f <= t && t.getTime() - f.getTime() <= 366 * 86400_000)
      return { key: "custom", from: f, to: t, label: `${from} – ${to}` };
  }
  const days = range === "today" ? 1 : range === "90d" ? 90 : range === "30d" ? 30 : 7;
  const label = range === "today" ? "Today" : `Last ${days} days`;
  return { key: range === "today" || range === "30d" || range === "90d" ? range! : "7d", from: startOfDay(new Date(toDate.getTime() - (days - 1) * 86400_000)), to: toDate, label };
}
export const inRange = (range: Range) => ({ gte: range.from, lte: range.to });
export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

export interface Metric { label: string; value: number | string; href: string; hint?: string }

export async function overviewMetrics(range: Range) {
  const created = inRange(range);
  const [
    users, newUsers, suspended, deletionRequests,
    businesses, activeBusinesses, pendingClaims, unclaimed,
    reviews, pendingReviews, publishedReviews, reportedReviews, appealedReviews,
    openReports, pendingAttachments, pendingReplies, unresolvedMessages,
    grades,
  ] = await Promise.all([
    db().user.count(), db().user.count({ where: { createdAt: created } }), db().user.count({ where: { disabledAt: { not: null } } }), db().user.count({ where: { deletionRequestedAt: { not: null } } }),
    db().business.count(), db().business.count({ where: { disabledAt: null } }), db().claim.count({ where: { status: { in: ["PENDING", "INFO_REQUESTED"] } } }), db().business.count({ where: { members: { none: {} }, claims: { none: { status: "PUBLISHED" } } } }),
    db().review.count(), db().review.count({ where: { status: "PENDING" } }), db().review.count({ where: ELIGIBLE_REVIEW_WHERE }), db().report.groupBy({ by: ["targetId"], where: { status: "PENDING", targetType: "review" } }).then(r => r.length), db().review.count({ where: { appealedAt: { not: null } } }),
    db().report.count({ where: { status: "PENDING" } }), db().attachment.count({ where: { status: "PENDING", reviewId: { not: null } } }), db().reply.count({ where: { status: "PENDING" } }), db().contactMessage.count({ where: { resolvedAt: null } }),
    db().review.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: created } }),
  ]);
  const gradeDistribution = await db().review.groupBy({ by: ["serviceGrade"], _count: { _all: true }, where: ELIGIBLE_REVIEW_WHERE });
  const scoreDistribution = await db().review.aggregate({ _avg: { score: true }, where: ELIGIBLE_REVIEW_WHERE });
  const byStatus = Object.fromEntries(grades.map(g => [g.status, g._count._all]));
  return {
    users, newUsers, suspended, deletionRequests,
    businesses, activeBusinesses, pendingClaims, unclaimed,
    reviews, pendingReviews, publishedReviews, reportedReviews, appealedReviews,
    openReports, pendingAttachments, pendingReplies, unresolvedMessages,
    submitted: byStatus, gradeDistribution, avgScore: scoreDistribution._avg.score,
  };
}

export function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n");
}

export async function notifyStaff(minimum: Role, message: string, href: string) {
  const ranks = STAFF_ROLES.filter(role => RANK[role] >= RANK[minimum]);
  const staff = await db().user.findMany({ where: { role: { in: ranks }, disabledAt: null }, select: { id: true } });
  if (staff.length) await db().notification.createMany({ data: staff.map(s => ({ userId: s.id, message, href })) });
}

export async function staffList() {
  return db().user.findMany({ where: { role: { in: STAFF_ROLES }, disabledAt: null }, select: { id: true, displayName: true, email: true, role: true }, orderBy: { displayName: "asc" } });
}

export const SORTS = {
  newest: { createdAt: "desc" }, oldest: { createdAt: "asc" }, name: { displayName: "asc" }, email: { email: "asc" },
} as const;
export function userSort(key?: string): Prisma.UserOrderByWithRelationInput {
  return SORTS[(key as keyof typeof SORTS) || "newest"] || SORTS.newest;
}

export const REPORT_KINDS = ["fake", "harassment", "personal-info", "spam", "conflict", "wrong-business", "copyright", "other"] as const;
export const REPORT_KIND_LABELS: Record<string, string> = {
  fake: "Suspected fake review", harassment: "Harassment or abuse", "personal-info": "Personal information exposure",
  spam: "Spam or conflict of interest", "wrong-business": "Incorrect business", copyright: "Copyright or privacy", other: "Other violation",
};
