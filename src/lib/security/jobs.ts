import { Prisma } from "@prisma/client";
import { db } from "../db";
import { securityConfig } from "./config";
import { feedsDue, refreshFeed } from "./feeds";
import { datasetFreshness } from "./providers/local";
import { runSecurityCheck } from "./review-security";
import { securityLog } from "./audit";

const JOB = "security-maintenance";
const LEASE_STALE_MS = 30 * 60_000;
const RETRY_BATCH = 50;
const REEVALUATE_BATCH = 100;

export interface JobSummary {
  skipped?: string;
  feeds: { source: string; ok: boolean; imported: number; error?: string }[];
  retried: number; reevaluated: number; flaggedOnReevaluation: number;
  cacheDeleted: number; recordsExpired: number; ipsPurged: number;
  durationMs: number;
}

// One runner at a time across all processes: a partial unique index on
// SecurityJobRun(job) WHERE status='running' acts as the lease. Stale leases
// (crashed runners) are released after LEASE_STALE_MS.
async function acquireLease() {
  await db().securityJobRun.updateMany({ where: { job: JOB, status: "running", startedAt: { lt: new Date(Date.now() - LEASE_STALE_MS) } }, data: { status: "failed", finishedAt: new Date(), error: "Lease expired" } });
  try {
    return await db().securityJobRun.create({ data: { job: JOB, status: "running" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

export async function runSecurityJobs(options: { forceFeeds?: boolean } = {}): Promise<JobSummary> {
  const started = Date.now();
  const config = securityConfig();
  const empty: JobSummary = { feeds: [], retried: 0, reevaluated: 0, flaggedOnReevaluation: 0, cacheDeleted: 0, recordsExpired: 0, ipsPurged: 0, durationMs: 0 };
  const lease = await acquireLease();
  if (!lease) return { ...empty, skipped: "another runner holds the lease" };
  const summary = { ...empty };
  try {
    // 1. Feeds (idempotent per source; failures keep the previous dataset).
    for (const feed of await feedsDue(options.forceFeeds)) {
      const result = await refreshFeed(feed);
      summary.feeds.push({ source: feed.source, ok: result.ok, imported: result.imported, error: result.error });
    }

    if (config.enabled) {
      // 2. Retry failed/pending checks whose backoff has elapsed. Pending
      //    checks older than 10 minutes without an attempt are included
      //    (e.g. the inline check was interrupted by a restart).
      const due = await db().reviewSecurityAssessment.findMany({
        where: { OR: [
          { decision: "SECURITY_CHECK_FAILED", nextRetryAt: { lte: new Date() } },
          { decision: "PENDING_SECURITY_CHECK", createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
          { decision: "SECURITY_CHECK_IN_PROGRESS", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        ] }, select: { reviewId: true }, take: RETRY_BATCH, orderBy: { updatedAt: "asc" },
      });
      for (const { reviewId } of due) {
        try { if ((await runSecurityCheck(reviewId)).ran) summary.retried++; }
        catch (error) { securityLog("retry_failed", { reviewId, error: error instanceof Error ? error.name : "Error" }); }
      }

      // 3. Re-evaluate cleared reviews after a material dataset update, while
      //    their encrypted IP is still retained. Cached provider verdicts are
      //    reused, so this never fans out one vendor call per historical review.
      const fresh = await datasetFreshness();
      if (fresh.version && !fresh.stale) {
        const outdated = await db().reviewSecurityAssessment.findMany({
          where: { decision: "SECURITY_CLEARED", encryptedIp: { not: null }, datasetVersion: { not: fresh.version }, review: { status: "PUBLISHED" } },
          select: { reviewId: true }, take: REEVALUATE_BATCH, orderBy: { checkedAt: "asc" },
        });
        for (const { reviewId } of outdated) {
          try {
            const outcome = await runSecurityCheck(reviewId, { force: true });
            if (outcome.ran) { summary.reevaluated++; if (outcome.state !== "SECURITY_CLEARED") summary.flaggedOnReevaluation++; }
          } catch (error) { securityLog("reevaluate_failed", { reviewId, error: error instanceof Error ? error.name : "Error" }); }
        }
      }
    }

    // 4. Housekeeping: expired caches and records, and raw-IP retention.
    summary.cacheDeleted = (await db().ipProviderCache.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
    summary.recordsExpired = (await db().ipIntelligenceRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
    summary.ipsPurged = (await db().reviewSecurityAssessment.updateMany({ where: { encryptedIp: { not: null }, createdAt: { lt: new Date(Date.now() - config.ipRetentionDays * 86400_000) } }, data: { encryptedIp: null } })).count;

    summary.durationMs = Date.now() - started;
    await db().securityJobRun.update({ where: { id: lease.id }, data: { status: "ok", finishedAt: new Date(), summary: summary as unknown as Prisma.InputJsonValue } });
    securityLog("jobs_completed", { ...summary });
    return summary;
  } catch (error) {
    await db().securityJobRun.update({ where: { id: lease.id }, data: { status: "failed", finishedAt: new Date(), error: error instanceof Error ? error.name : "Error", summary: summary as unknown as Prisma.InputJsonValue } }).catch(() => {});
    throw error;
  }
}

export async function recentJobRuns(take = 10) {
  return db().securityJobRun.findMany({ orderBy: { startedAt: "desc" }, take });
}

// In-process scheduler for single-instance deployments; multi-instance
// deployments should run `npm run security:worker` from cron instead (the
// lease keeps both modes safe together).
declare global { var __securityScheduler: NodeJS.Timeout | undefined }
export function startInProcessScheduler(intervalMs = 15 * 60_000, initialDelayMs = 60_000) {
  if (globalThis.__securityScheduler) return;
  const tick = () => runSecurityJobs().catch(error => securityLog("scheduler_run_failed", { error: error instanceof Error ? error.name : "Error" }));
  const first = setTimeout(tick, initialDelayMs);
  first.unref();
  globalThis.__securityScheduler = setInterval(tick, intervalMs);
  globalThis.__securityScheduler.unref();
}
