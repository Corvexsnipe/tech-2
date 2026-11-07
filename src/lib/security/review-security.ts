import { Prisma, type SecurityState } from "@prisma/client";
import { AppError, db } from "../db";
import { activeReviewKey } from "../grades";
import { mailConfigured, sendReviewConfirmation } from "../mail";
import { securityConfig } from "./config";
import { isPublicIp, parseIp } from "./cidr";
import { decryptIp, encryptIp, ipHashCurrent, ipHashes } from "./ip-resolver";
import { asnClassificationProvider, localIntelligenceProvider, velocityProvider } from "./providers/local";
import { externalProvider } from "./providers/external";
import type { IntelligenceProvider, ProviderResult } from "./providers/types";
import { decide, scoreSignals, type Decision } from "./risk-scoring";
import { securityAudit, securityLog } from "./audit";

type Tx = Prisma.TransactionClient;
const FLAGGED: SecurityState[] = ["FLAGGED_VPN", "FLAGGED_PROXY", "FLAGGED_TOR", "FLAGGED_HIGH_RISK"];
const CLAIMABLE: SecurityState[] = ["PENDING_SECURITY_CHECK", "SECURITY_CHECK_FAILED"];
const IN_PROGRESS_STALE_MS = 5 * 60_000;

export function providersFor(config = securityConfig()): IntelligenceProvider[] {
  const list: IntelligenceProvider[] = [localIntelligenceProvider, asnClassificationProvider, velocityProvider];
  if (config.mode === "hybrid" && config.externalProvider !== "none") list.push(externalProvider());
  return list;
}

// Called inside the review-submit transaction: records the hash/version and
// the encrypted IP so the check can run after commit and be retried later.
export async function createAssessment(tx: Tx, reviewId: string, ip: string | null) {
  const hashed = ip ? ipHashCurrent(ip) : null;
  await tx.reviewSecurityAssessment.create({ data: {
    reviewId, ipHash: hashed?.hash ?? null, ipHashVersion: hashed?.version ?? 1,
    encryptedIp: ip ? encryptIp(ip) : null,
    decision: "PENDING_SECURITY_CHECK", classification: "INSUFFICIENT_EVIDENCE",
  } });
  await securityAudit(tx, { reviewId, action: "assessment-created", newState: "PENDING_SECURITY_CHECK", reasonCode: ip ? "IP_RESOLVED" : "IP_UNAVAILABLE" });
}

function backoffMs(retry: number) {
  return Math.min(6 * 3600_000, 5 * 60_000 * 2 ** retry) + Math.floor(Math.random() * 30_000);
}

export interface CheckOutcome { ran: boolean; state: SecurityState; published: boolean; decision?: Decision; score?: number }

// Runs a full security check for one review. Safe to call concurrently and
// repeatedly: the claim step is an atomic conditional update, provider calls
// happen outside any transaction, and the apply step is one short transaction.
export async function runSecurityCheck(reviewId: string, options: { ip?: string | null; force?: boolean; actorId?: string | null } = {}): Promise<CheckOutcome> {
  const config = securityConfig();
  const review = await db().review.findUnique({ where: { id: reviewId }, include: { securityAssessment: true, business: { select: { name: true } }, user: { select: { id: true, email: true, displayName: true } } } });
  if (!review) throw new AppError("Review not found.", 404);
  const assessment = review.securityAssessment ?? await db().reviewSecurityAssessment.create({ data: { reviewId } });

  if (!config.enabled) {
    // Detection disabled by configuration: mark cleared so staff can approve,
    // but say so in the audit trail.
    return applyDecision(review.id, { classification: "INSUFFICIENT_EVIDENCE", state: "SECURITY_CLEARED", reasonCode: "DETECTION_DISABLED", band: "low" }, { score: 0, contributions: [], results: [], datasetVersion: null, actorId: options.actorId });
  }

  const claimable = options.force || CLAIMABLE.includes(review.securityState)
    || (review.securityState === "SECURITY_CHECK_IN_PROGRESS" && assessment.updatedAt.getTime() < Date.now() - IN_PROGRESS_STALE_MS);
  if (!claimable) return { ran: false, state: review.securityState, published: review.status === "PUBLISHED" };
  const claimed = await db().review.updateMany({ where: { id: review.id, securityState: review.securityState }, data: { securityState: "SECURITY_CHECK_IN_PROGRESS" } });
  if (claimed.count === 0) return { ran: false, state: review.securityState, published: review.status === "PUBLISHED" };
  await db().reviewSecurityAssessment.update({ where: { reviewId: review.id }, data: { decision: "SECURITY_CHECK_IN_PROGRESS" } });

  const ip = options.ip ?? decryptIp(assessment.encryptedIp);
  const parsedIp = ip ? parseIp(ip) : null;
  if (!ip || !parsedIp || !isPublicIp(parsedIp)) {
    // No IP at all, or a loopback/private/reserved address that can never be
    // verified against public intelligence — hold for staff, never clear.
    return applyDecision(review.id, { classification: "DETECTION_ERROR", state: "MANUAL_REVIEW_REQUIRED", reasonCode: ip ? "IP_NOT_PUBLIC" : "IP_UNAVAILABLE", band: "low" }, { score: 0, contributions: [], results: [], datasetVersion: null, previous: review.securityState, actorId: options.actorId });
  }

  let results: ProviderResult[] = [];
  try {
    const input = { ip, ipHashes: ipHashes(ip), reviewId: review.id, businessId: review.businessId, userId: review.userId };
    const providers = providersFor(config);
    const settled = await Promise.allSettled(providers.map(p => p.check(input)));
    results = settled.map((s, i) => s.status === "fulfilled" ? s.value : { provider: providers[i].name, kind: providers[i].kind, status: "error" as const, authoritative: providers[i].kind === "local" || providers[i].kind === "external", signals: [], latencyMs: 0, error: s.reason instanceof Error ? s.reason.name : "Error" });
  } catch (error) {
    securityLog("check_exception", { reviewId, error: error instanceof Error ? error.name : "Error" });
  }
  const scored = scoreSignals(results);
  const decision = decide(results, scored, config, config.failClosed);
  const datasetVersion = results.find(r => r.kind === "local")?.datasetVersion ?? null;
  return applyDecision(review.id, decision, { score: scored.score, contributions: scored.contributions, results, datasetVersion, previous: review.securityState, actorId: options.actorId });
}

interface ApplyContext {
  score: number; contributions: unknown[]; results: ProviderResult[]; datasetVersion: string | null;
  previous?: SecurityState; actorId?: string | null;
}

async function applyDecision(reviewId: string, decision: Decision, ctx: ApplyContext): Promise<CheckOutcome> {
  const config = securityConfig();
  const outcome = await db().$transaction(async tx => {
    const review = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: { securityAssessment: true, business: { select: { name: true } } } });
    const assessment = review.securityAssessment!;
    const previous = ctx.previous ?? review.securityState;
    let state: SecurityState = decision.state;
    let retryCount = assessment.retryCount, nextRetryAt: Date | null = null;
    if (state === "SECURITY_CHECK_FAILED") {
      retryCount += 1;
      if (retryCount >= config.maxRetries) { state = "MANUAL_REVIEW_REQUIRED"; decision = { ...decision, reasonCode: "RETRIES_EXHAUSTED" }; }
      else nextRetryAt = new Date(Date.now() + backoffMs(retryCount));
    }
    // Status transitions keep the invariant PUBLISHED ⇒ SECURITY_CLEARED.
    // Clearing security never publishes on its own: every review still waits
    // for an explicit staff moderation decision before it becomes public.
    let status = review.status, moderationNote = review.moderationNote;
    if (FLAGGED.includes(state) || state === "MANUAL_REVIEW_REQUIRED") {
      if (review.status === "PUBLISHED") { status = "HIDDEN"; moderationNote = `Hidden by network security verification (${decision.classification}).`; }
    }
    await tx.reviewSecurityAssessment.update({ where: { reviewId }, data: {
      riskScore: ctx.score, classification: decision.classification, decision: state,
      signals: ctx.contributions as Prisma.InputJsonValue, providerStatus: ctx.results.map(r => ({ provider: r.provider, kind: r.kind, status: r.status, latencyMs: r.latencyMs, error: r.error ?? null, datasetVersion: r.datasetVersion ?? null })) as Prisma.InputJsonValue,
      datasetVersion: ctx.datasetVersion, checkedAt: new Date(), expiresAt: new Date(Date.now() + config.cacheTtlSeconds * 1000),
      retryCount, nextRetryAt, lastError: state === "SECURITY_CHECK_FAILED" || decision.classification === "DETECTION_ERROR" || decision.classification === "DATA_STALE" ? decision.reasonCode : null,
    } });
    await tx.review.update({ where: { id: reviewId }, data: { securityState: state, status, moderationNote } });
    await securityAudit(tx, { reviewId, actorId: ctx.actorId ?? null, action: ctx.actorId ? "manual-recheck" : "automated-check", previousState: previous, newState: state, reasonCode: decision.reasonCode, metadata: { classification: decision.classification, score: ctx.score, band: decision.band, retryCount, statusAfter: status } });
    if (state === "SECURITY_CLEARED" && previous !== "SECURITY_CLEARED") {
      await tx.notification.create({ data: { userId: review.userId, message: "Your review passed security verification and is awaiting team approval before publication.", href: "/account" } });
      const staff = await tx.user.findMany({ where: { role: { in: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] }, disabledAt: null }, select: { id: true } });
      if (staff.length) await tx.notification.createMany({ data: staff.map(s => ({ userId: s.id, message: `A review for ${review.business.name} passed verification and awaits approval.`, href: `/review-matter-panel/reviews/${reviewId}` })) });
    } else if (FLAGGED.includes(state) || state === "MANUAL_REVIEW_REQUIRED") {
      if (previous !== state) await tx.notification.create({ data: { userId: review.userId, message: "Your review is being verified before publication. You will be notified when a decision is made.", href: "/account" } });
    }
    return { state, review };
  }, { isolationLevel: "Serializable", timeout: 20000, maxWait: 10000 });

  securityLog("decision", { reviewId, state: outcome.state, classification: decision.classification, score: ctx.score, reason: decision.reasonCode });
  return { ran: true, state: outcome.state, published: outcome.review.status === "PUBLISHED" && outcome.state === "SECURITY_CLEARED", decision, score: ctx.score };
}

// Staff overrides. The original assessment is never overwritten; every
// override is a new audit row carrying actor, reason and the prior state.
export type ManualDecision = "clear" | "reject" | "hold";
export async function manualSecurityDecision(reviewId: string, actorId: string, decision: ManualDecision, reason: string) {
  const outcome = await db().$transaction(async tx => {
    const review = await tx.review.findUnique({ where: { id: reviewId }, include: { securityAssessment: true } });
    if (!review) throw new AppError("Review not found.", 404);
    if (review.userId === actorId) throw new AppError("You cannot decide on your own review.", 403);
    const previous = review.securityState;
    let state: SecurityState = previous, status = review.status, publish = false, note = review.moderationNote;
    if (decision === "clear") {
      state = "SECURITY_CLEARED";
      if (review.status === "PENDING" || review.status === "HIDDEN") { status = "PUBLISHED"; publish = true; note = null; }
    } else if (decision === "hold") {
      state = "MANUAL_REVIEW_REQUIRED";
      if (review.status === "PUBLISHED") { status = "HIDDEN"; note = "Hidden pending manual security review."; }
    } else {
      status = "REJECTED"; note = reason;
    }
    try {
      await tx.review.update({ where: { id: reviewId }, data: { securityState: state, status, moderationNote: note, ...(publish ? { activeKey: activeReviewKey(review.userId, review.businessId) } : {}) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("Publishing conflicts with another active review from the same reviewer or network. Resolve that review first.", 409);
      throw error;
    }
    if (review.securityAssessment) await tx.reviewSecurityAssessment.update({ where: { reviewId }, data: { decision: state, nextRetryAt: null } });
    await securityAudit(tx, { reviewId, actorId, action: `manual-${decision}`, previousState: previous, newState: state, reasonCode: `MANUAL_${decision.toUpperCase()}`, metadata: { reason, statusBefore: review.status, statusAfter: status, originalClassification: review.securityAssessment?.classification ?? null, originalScore: review.securityAssessment?.riskScore ?? null } });
    await tx.auditLog.create({ data: { actorId, action: `security-${decision}`, targetId: reviewId, detail: `${previous} → ${state}; review ${review.status} → ${status}: ${reason}` } });
    await tx.notification.create({ data: { userId: review.userId, message: decision === "clear" ? "Your review passed verification and is now published." : decision === "reject" ? `Your review could not be published. ${reason}` : "Your review is under additional verification.", href: "/account" } });
    return { publish, review };
  }, { isolationLevel: "Serializable", timeout: 20000, maxWait: 10000 });
  if (outcome.publish && mailConfigured()) {
    const user = await db().user.findUnique({ where: { id: outcome.review.userId }, select: { id: true, email: true, displayName: true } });
    const business = await db().business.findUnique({ where: { id: outcome.review.businessId }, select: { name: true } });
    if (user && business) void sendReviewConfirmation(user, reviewId, business.name).catch(() => {});
  }
}

// Runs the check with a time budget so submissions stay responsive. If the
// budget elapses the check keeps running in the background and the caller
// reports "verification in progress"; the review remains unpublished.
export async function runSecurityCheckWithBudget(reviewId: string, ip: string | null, budgetMs = securityConfig().inlineBudgetMs): Promise<CheckOutcome | "in-progress"> {
  const run = runSecurityCheck(reviewId, { ip }).catch(error => {
    securityLog("inline_check_failed", { reviewId, error: error instanceof Error ? error.name : "Error" });
    return { ran: false, state: "SECURITY_CHECK_FAILED" as SecurityState, published: false };
  });
  if (budgetMs <= 0) { void run; return "in-progress"; }
  const timer = new Promise<"in-progress">(resolve => setTimeout(() => resolve("in-progress"), budgetMs));
  return Promise.race([run, timer]);
}
