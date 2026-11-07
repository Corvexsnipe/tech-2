import { db } from "../db";
import { securityConfig } from "./config";
import { feedHealth } from "./feeds";
import { datasetFreshness } from "./providers/local";
import { recentJobRuns } from "./jobs";
import { FLAGGED_STATES, UNRESOLVED_STATES } from "./review-eligibility";

// Aggregates for the Security Center and the /api/admin/security endpoint.
// Contains no IPs, hashes, secrets or raw provider payloads.
export async function securityOverview() {
  const config = securityConfig();
  const [total, bands, byDecision, pending, manual, failedRetry, flagged, providers, feeds, fresh, jobs] = await Promise.all([
    db().reviewSecurityAssessment.count(),
    Promise.all([
      db().reviewSecurityAssessment.count({ where: { checkedAt: { not: null }, riskScore: { lte: config.lowRiskMax } } }),
      db().reviewSecurityAssessment.count({ where: { checkedAt: { not: null }, riskScore: { gt: config.lowRiskMax, lt: config.highRiskMin } } }),
      db().reviewSecurityAssessment.count({ where: { checkedAt: { not: null }, riskScore: { gte: config.highRiskMin } } }),
    ]),
    db().review.groupBy({ by: ["securityState"], _count: { _all: true } }),
    db().review.count({ where: { securityState: { in: ["PENDING_SECURITY_CHECK", "SECURITY_CHECK_IN_PROGRESS", "SECURITY_CHECK_FAILED"] } } }),
    db().review.count({ where: { securityState: "MANUAL_REVIEW_REQUIRED" } }),
    db().reviewSecurityAssessment.count({ where: { decision: "SECURITY_CHECK_FAILED" } }),
    db().review.count({ where: { securityState: { in: [...FLAGGED_STATES] } } }),
    db().securityProviderHealth.findMany({ orderBy: { provider: "asc" } }),
    feedHealth(),
    datasetFreshness(),
    recentJobRuns(8),
  ]);
  const states = Object.fromEntries(byDecision.map(d => [d.securityState, d._count._all])) as Record<string, number>;
  const warnings = [...config.warnings];
  if (config.enabled && fresh.stale) warnings.push(fresh.version ? `Local intelligence is stale (last import ${fresh.version}); new reviews cannot be cleared until a feed refresh succeeds.` : "No intelligence feed has imported yet; new reviews stay pending until the first successful import.");
  for (const p of providers) if (p.consecutiveFailures >= 3) warnings.push(`External provider ${p.provider} has failed ${p.consecutiveFailures} times in a row (${p.errorSummary ?? "unknown error"}).`);
  const lastJob = jobs[0];
  if (config.enabled && (!lastJob || lastJob.startedAt.getTime() < Date.now() - 2 * 3600_000)) warnings.push("No security job has run in the last 2 hours. Check the in-process scheduler or the cron worker.");
  return {
    config: { enabled: config.enabled, mode: config.mode, failClosed: config.failClosed, externalProvider: config.externalProvider, bands: { lowRiskMax: config.lowRiskMax, mediumRiskMax: config.mediumRiskMax, highRiskMin: config.highRiskMin }, hmacVersion: config.hmacVersion, ipRetentionDays: config.ipRetentionDays, feedRefreshIntervalHours: config.feedRefreshIntervalHours, maxDataAgeHours: config.maxDataAgeHours },
    totals: { checks: total, low: bands[0], medium: bands[1], high: bands[2], pending, manual, failedRetry, flagged, vpn: states.FLAGGED_VPN ?? 0, proxy: states.FLAGGED_PROXY ?? 0, tor: states.FLAGGED_TOR ?? 0, highRisk: states.FLAGGED_HIGH_RISK ?? 0, cleared: states.SECURITY_CLEARED ?? 0 },
    states, providers, feeds, dataset: fresh, jobs, warnings,
    unresolvedStates: UNRESOLVED_STATES,
  };
}
