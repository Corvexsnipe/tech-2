import { NextResponse } from "next/server";
import { currentUser } from "@/lib/security";
import { isStaff } from "@/lib/admin";
import { securityOverview } from "@/lib/security/dashboard";

export const runtime = "nodejs";

// Staff-only health/metrics endpoint for monitoring and alerting. Returns
// aggregate counters only — never IPs, hashes, keys or provider payloads.
export async function GET() {
  const user = await currentUser();
  if (!user || !isStaff(user) || !user.verifiedAt || user.disabledAt) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const overview = await securityOverview();
    const healthy = overview.warnings.length === 0;
    return NextResponse.json({
      status: healthy ? "ok" : "attention",
      config: overview.config, totals: overview.totals, warnings: overview.warnings,
      dataset: { version: overview.dataset.version, stale: overview.dataset.stale, feeds: overview.dataset.feeds, imported: overview.dataset.imported },
      feeds: overview.feeds.map(f => ({ source: f.source, category: f.category, enabled: f.enabled, status: f.status, lastSuccessAt: f.lastSuccessAt, activeRecords: f.activeRecords, stale: f.stale, errorCode: f.errorCode })),
      providers: overview.providers.map(p => ({ provider: p.provider, status: p.status, lastSuccessAt: p.lastSuccessAt, lastLatencyMs: p.lastLatencyMs, consecutiveFailures: p.consecutiveFailures })),
      lastJob: overview.jobs[0] ? { status: overview.jobs[0].status, startedAt: overview.jobs[0].startedAt, finishedAt: overview.jobs[0].finishedAt } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error", error: "Security overview unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
