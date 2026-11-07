import type { Prisma } from "@prisma/client";

// The single rule for "does this review count". Used by every aggregate
// (grades, counts, trends, admin metrics). The state machine also maintains
// the invariant PUBLISHED ⇒ SECURITY_CLEARED, so legacy `status: "PUBLISHED"`
// filters stay correct, but new code should use this clause directly.
export const ELIGIBLE_REVIEW_WHERE = { status: "PUBLISHED", securityState: "SECURITY_CLEARED" } as const satisfies Prisma.ReviewWhereInput;

export function isEligibleReview(review: { status: string; securityState: string }) {
  return review.status === "PUBLISHED" && review.securityState === "SECURITY_CLEARED";
}

export const FLAGGED_STATES = ["FLAGGED_VPN", "FLAGGED_PROXY", "FLAGGED_TOR", "FLAGGED_HIGH_RISK"] as const;
export const UNRESOLVED_STATES = ["PENDING_SECURITY_CHECK", "SECURITY_CHECK_IN_PROGRESS", "SECURITY_CHECK_FAILED", "MANUAL_REVIEW_REQUIRED"] as const;
