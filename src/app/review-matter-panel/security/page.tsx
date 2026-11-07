import Link from "next/link";
import { Prisma, SecurityState } from "@prisma/client";
import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { securityOverview } from "@/lib/security/dashboard";
import { CLASSIFICATIONS } from "@/lib/security/risk-scoring";
import { FEED_CATEGORIES } from "@/lib/security/feeds";
import { EmptyState, Pagination } from "@/components/shared";
import { ActionForm, Field } from "@/components/forms";
import { StatusPill } from "@/components/admin-blocks";
import { RiskBadge, SecurityStatePill, STATE_LABELS } from "@/components/security-blocks";

const BASE = "/review-matter-panel/security";
const STATES = Object.keys(STATE_LABELS) as SecurityState[];
const QUEUES = [["manual", "Manual review"], ["flagged", "Flagged"], ["pending", "Pending / retrying"], ["all", "All checks"]] as const;

export default async function SecurityCenter({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await panelUser("MODERATOR");
  const params = await searchParams;
  const queue = QUEUES.some(([q]) => q === params.queue) ? params.queue! : "manual";
  const state = STATES.includes(params.state as SecurityState) ? (params.state as SecurityState) : undefined;
  const classification = CLASSIFICATIONS.includes(params.reason as (typeof CLASSIFICATIONS)[number]) ? params.reason : undefined;
  const q = (params.q || "").slice(0, 100);
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? new Date(`${params.from}T00:00:00Z`) : undefined;
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? new Date(`${params.to}T23:59:59.999Z`) : undefined;
  const page = pageNumber(params.page), take = 20, skip = (page - 1) * take;
  const canAdmin = hasRole(me, "ADMIN"), canSuper = hasRole(me, "SUPER_ADMIN");

  const where: Prisma.ReviewWhereInput = {
    securityAssessment: { isNot: null },
    ...(state ? { securityState: state } : queue === "manual" ? { securityState: "MANUAL_REVIEW_REQUIRED" } : queue === "flagged" ? { securityState: { in: ["FLAGGED_VPN", "FLAGGED_PROXY", "FLAGGED_TOR", "FLAGGED_HIGH_RISK"] } } : queue === "pending" ? { securityState: { in: ["PENDING_SECURITY_CHECK", "SECURITY_CHECK_IN_PROGRESS", "SECURITY_CHECK_FAILED"] } } : {}),
    ...(classification ? { securityAssessment: { classification } } : {}),
    ...(q ? { OR: [{ headline: { contains: q, mode: "insensitive" } }, { business: { name: { contains: q, mode: "insensitive" } } }, { user: { email: { contains: q, mode: "insensitive" } } }] } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [overview, rows, count, audit] = await Promise.all([
    securityOverview(),
    db().review.findMany({ where, orderBy: [{ securityAssessment: { riskScore: "desc" } }, { createdAt: "asc" }], take, skip, include: { securityAssessment: true, business: { select: { name: true } }, user: { select: { displayName: true, email: true } } } }),
    db().review.count({ where }),
    db().reviewSecurityAuditLog.findMany({ where: { actorId: { not: null } }, orderBy: { createdAt: "desc" }, take: 12, include: { review: { select: { headline: true } } } }),
  ]);
  const actors = new Map((await db().user.findMany({ where: { id: { in: audit.map(a => a.actorId!).filter(Boolean) } }, select: { id: true, displayName: true } })).map(u => [u.id, u.displayName]));
  const query = { queue, state: state ?? "", reason: classification ?? "", q, from: params.from ?? "", to: params.to ?? "" };
  const bands = overview.config.bands;

  return <>
    <div className="page-heading"><span className="eyebrow purple">SECURITY CENTER</span><h1>Anti-VPN & network verification.</h1><p>Every review is checked against local intelligence feeds{overview.config.externalProvider !== "none" ? ` and ${overview.config.externalProvider}` : ""} before it can publish or count toward a grade. Scores are estimates from listed evidence — never a probability of fraud. Mode: <strong>{overview.config.enabled ? overview.config.mode : "disabled"}</strong>{overview.config.enabled && (overview.config.failClosed ? " · fail-closed" : " · errors → manual review")}.</p></div>

    {overview.warnings.length > 0 && <div className="notice warning" role="status"><strong>Attention</strong><ul style={{ margin: "6px 0 0 16px", padding: 0 }}>{overview.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}

    <div className="metric-grid">
      {[["Checks performed", overview.totals.checks], ["Low risk", overview.totals.low], ["Medium risk", overview.totals.medium], ["High risk", overview.totals.high],
        ["Cleared", overview.totals.cleared], ["VPN", overview.totals.vpn], ["Proxy", overview.totals.proxy], ["Tor", overview.totals.tor],
        ["Pending / retrying", overview.totals.pending], ["Manual queue", overview.totals.manual], ["Retry queue", overview.totals.failedRetry], ["Flagged total", overview.totals.flagged]].map(([label, value]) =>
        <div className="metric-card" key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
    </div>

    <div className="panel-grid-2">
      <section className="panel"><h3>Intelligence feeds</h3>
        <p style={{ fontSize: 11.5, marginBottom: 8 }}>Dataset {overview.dataset.version ? `version ${overview.dataset.version.slice(0, 19).replace("T", " ")}` : "not imported yet"} · {overview.dataset.stale ? <span className="badge err">stale</span> : <span className="badge ok">fresh</span>} · max age {overview.config.maxDataAgeHours}h · refresh every {overview.config.feedRefreshIntervalHours}h. Local lists cannot detect new, residential or rotating endpoints.</p>
        <table className="data-table"><thead><tr><th>Source</th><th>Category</th><th>Status</th><th>Records</th><th>Last success</th>{canAdmin && <th></th>}</tr></thead><tbody>
          {overview.feeds.map(f => <tr key={f.id}>
            <td><strong>{f.source}</strong><br /><small style={{ color: "var(--muted)" }}>{f.license}</small></td>
            <td>{f.category} · {f.confidence}%</td>
            <td><span className={`badge ${!f.enabled ? "dim" : f.status === "ok" && !f.stale ? "ok" : f.status === "never" ? "warn" : "err"}`}>{!f.enabled ? "disabled" : f.stale && f.status === "ok" ? "stale" : f.status}</span>{f.errorCode && <><br /><small>{f.errorCode}</small></>}</td>
            <td>{f.activeRecords}</td>
            <td><small>{f.lastSuccessAt ? f.lastSuccessAt.toLocaleString() : "never"}</small></td>
            {canAdmin && <td><ActionForm action="admin-security-feed" fixed={{ id: f.id }} submitButtons={[{ name: "op", value: "refresh", label: "Refresh", className: "button secondary small" }, { name: "op", value: f.enabled ? "disable" : "enable", label: f.enabled ? "Disable" : "Enable", className: "button secondary small" }]} /></td>}
          </tr>)}
        </tbody></table>
        {canSuper && <details style={{ marginTop: 12 }}><summary className="text-link" style={{ cursor: "pointer" }}>Add a feed (https, one IP or CIDR per line)</summary>
          <ActionForm action="admin-security-feed-add" label="Add feed" numbers={["confidence"]}>
            <div className="form-row"><Field label="Source id" name="source" minLength={3} maxLength={60} hint="lowercase, digits, dashes" /><Field label="Confidence (1–100)" name="confidence" type="number" defaultValue={70} /></div>
            <Field label="Feed URL" name="url" type="url" maxLength={500} />
            <label className="field"><span>Category</span><select name="category" defaultValue="VPN">{FEED_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            <Field label="License / attribution note" name="license" minLength={5} maxLength={300} hint="Record how this dataset may be used. Do not add feeds you are not licensed to use." />
          </ActionForm></details>}
      </section>

      <section className="panel"><h3>Providers & jobs</h3>
        <table className="data-table"><tbody>
          <tr><td>local-intelligence</td><td><span className={`badge ${overview.dataset.stale ? "err" : "ok"}`}>{overview.dataset.stale ? "stale" : "ok"}</span></td><td><small>{overview.dataset.imported}/{overview.dataset.feeds} enabled feeds imported</small></td></tr>
          <tr><td>external provider</td><td><span className={`badge ${overview.config.externalProvider === "none" ? "dim" : "ok"}`}>{overview.config.externalProvider}</span></td><td><small>{overview.config.externalProvider === "none" ? "Not configured — local-only coverage" : "Server-side, cached per IP hash"}</small></td></tr>
          {overview.providers.map(p => <tr key={p.provider}><td>{p.provider}</td><td><span className={`badge ${p.status === "ok" ? "ok" : "err"}`}>{p.status}</span></td><td><small>{p.lastLatencyMs ?? "—"} ms · {p.consecutiveFailures} consecutive failures{p.lastSuccessAt ? ` · last ok ${p.lastSuccessAt.toLocaleString()}` : ""}</small></td></tr>)}
        </tbody></table>
        <strong style={{ fontSize: 12, display: "block", marginTop: 12 }}>Recent job runs</strong>
        {overview.jobs.length === 0 ? <p style={{ fontSize: 12 }}>No runs yet. The in-process scheduler starts ~1 minute after boot; <code>npm run security:worker</code> runs it from cron.</p> :
          <table className="data-table" style={{ marginTop: 6 }}><tbody>{overview.jobs.map(j => {
            const s = j.summary as { feeds?: unknown[]; retried?: number; reevaluated?: number; flaggedOnReevaluation?: number; skipped?: string } | null;
            return <tr key={j.id}><td><small>{j.startedAt.toLocaleString()}</small></td><td><span className={`badge ${j.status === "ok" ? "ok" : j.status === "running" ? "warn" : "err"}`}>{j.status}</span></td><td><small>{s?.skipped ? s.skipped : s ? `${s.feeds?.length ?? 0} feeds · ${s.retried ?? 0} retried · ${s.reevaluated ?? 0} re-evaluated (${s.flaggedOnReevaluation ?? 0} flagged)` : j.error ?? ""}</small></td></tr>;
          })}</tbody></table>}
        {canAdmin && <div style={{ marginTop: 10 }}><ActionForm action="admin-security-run" submitButtons={[{ name: "run", label: "Run jobs now", className: "button secondary small" }, { name: "feeds", label: "Run + force feed refresh", className: "button secondary small" }]} booleans={["feeds"]} /></div>}
      </section>
    </div>

    <div className="panel-tabs">{QUEUES.map(([key, label]) => <Link key={key} href={`${BASE}?queue=${key}`} className={queue === key && !state ? "active" : ""}>{label}</Link>)}</div>
    <form className="search-bar" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto" }} action={BASE}>
      <input type="hidden" name="queue" value={queue} />
      <input name="q" aria-label="Search" defaultValue={q} placeholder="Business, headline, or reviewer email…" maxLength={100} />
      <label><span className="sr-only">State</span><select name="state" defaultValue={state ?? ""}><option value="">Any state</option>{STATES.map(s => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}</select></label>
      <label><span className="sr-only">Reason</span><select name="reason" defaultValue={classification ?? ""}><option value="">Any reason</option>{CLASSIFICATIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></label>
      <label><span className="sr-only">From</span><input type="date" name="from" defaultValue={params.from ?? ""} /></label>
      <label><span className="sr-only">To</span><input type="date" name="to" defaultValue={params.to ?? ""} /></label>
      <button className="button primary">Filter</button>
    </form>

    {count === 0 ? <EmptyState title="Nothing in this queue." description="Reviews matching these filters will appear here." /> :
      <table className="data-table"><thead><tr><th>Review</th><th>Business</th><th>Risk</th><th>Classification</th><th>Security state</th><th>Review status</th><th>Checked</th><th></th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}>
          <td><strong>{r.headline}</strong><br /><small style={{ color: "var(--muted)" }}>{r.user.displayName} · {r.user.email}</small></td>
          <td>{r.business.name}</td>
          <td>{r.securityAssessment ? <RiskBadge score={r.securityAssessment.riskScore} bands={bands} /> : "—"}</td>
          <td><small>{r.securityAssessment?.classification.replace(/_/g, " ") ?? "—"}</small>{r.securityAssessment?.retryCount ? <><br /><small>retry {r.securityAssessment.retryCount}{r.securityAssessment.nextRetryAt ? ` · next ${r.securityAssessment.nextRetryAt.toLocaleTimeString()}` : ""}</small></> : null}</td>
          <td><SecurityStatePill state={r.securityState} /></td>
          <td><StatusPill status={r.status} /></td>
          <td><small>{r.securityAssessment?.checkedAt ? r.securityAssessment.checkedAt.toLocaleString() : "—"}</small></td>
          <td><Link className="text-link" href={`/review-matter-panel/reviews/${r.id}`}>Open →</Link></td>
        </tr>)}
      </tbody></table>}
    <Pagination base={BASE} query={query} page={page} total={count} pageSize={take} />

    <section className="panel" style={{ marginTop: 16 }}><h3>Recent manual decisions</h3>
      {audit.length === 0 ? <p style={{ fontSize: 12, marginTop: 8 }}>No manual overrides recorded.</p> :
        audit.map(a => <div className="audit-row" key={a.id}><strong>{a.action}</strong> <small>{a.reasonCode}</small><p><Link className="text-link" href={`/review-matter-panel/reviews/${a.reviewId}`}>{a.review.headline}</Link> · {a.previousState ? STATE_LABELS[a.previousState] : "—"} → {a.newState ? STATE_LABELS[a.newState] : "—"}</p><small>{actors.get(a.actorId!) ?? "staff"} · {a.createdAt.toISOString()}</small></div>)}
    </section>
  </>;
}
