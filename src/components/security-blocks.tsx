import Link from "next/link";
import type { ReviewSecurityAssessment, ReviewSecurityAuditLog, SecurityState } from "@prisma/client";
import { ActionForm, Field } from "./forms";

export const STATE_LABELS: Record<SecurityState, string> = {
  PENDING_SECURITY_CHECK: "Pending check", SECURITY_CHECK_IN_PROGRESS: "Checking", SECURITY_CLEARED: "Cleared",
  FLAGGED_VPN: "Flagged: VPN", FLAGGED_PROXY: "Flagged: proxy", FLAGGED_TOR: "Flagged: Tor", FLAGGED_HIGH_RISK: "Flagged: high risk",
  SECURITY_CHECK_FAILED: "Check failed (retrying)", MANUAL_REVIEW_REQUIRED: "Manual review",
};

export function SecurityStatePill({ state }: { state: SecurityState }) {
  const tone = state === "SECURITY_CLEARED" ? "ok" : state.startsWith("FLAGGED") ? "err" : "warn";
  return <span className={`badge ${tone}`}>{STATE_LABELS[state]}</span>;
}

export function RiskBadge({ score, bands }: { score: number; bands: { lowRiskMax: number; highRiskMin: number } }) {
  const band = score >= bands.highRiskMin ? "high" : score > bands.lowRiskMax ? "medium" : "low";
  return <span className={`badge ${band === "high" ? "err" : band === "medium" ? "warn" : "ok"}`} title="Estimated risk score, not a probability of fraud">{score} · {band}</span>;
}

interface Contribution { group: string; category: string; source: string; code: string; confidence: number; contribution: number; detail: string }
interface ProviderRow { provider: string; kind: string; status: string; latencyMs: number; error: string | null; datasetVersion: string | null }

export function AssessmentPanel({ assessment, state, bands, canDecide, canRecheck, isOwnReview, audit, ip }: {
  assessment: ReviewSecurityAssessment | null; state: SecurityState; bands: { lowRiskMax: number; highRiskMin: number };
  canDecide: boolean; canRecheck: boolean; isOwnReview: boolean; audit: ReviewSecurityAuditLog[];
  /** Decrypted client IP — pass only for ADMIN+ viewers; undefined hides the row. */
  ip?: string | null;
}) {
  const signals = (assessment?.signals as unknown as Contribution[] | null) ?? [];
  const providers = (assessment?.providerStatus as unknown as ProviderRow[] | null) ?? [];
  return <section className="panel"><h3>Network security verification</h3>
    <table className="data-table" style={{ marginTop: 12 }}><tbody>
      <tr><td>State</td><td><SecurityStatePill state={state} /></td></tr>
      {assessment && <>
        {ip !== undefined && <tr><td>Client IP</td><td>{ip ? <code>{ip}</code> : <small style={{ color: "var(--muted)" }}>{assessment.ipHash ? "purged after retention window" : "unresolved"}</small>} <small style={{ color: "var(--muted)" }}>· hash v{assessment.ipHashVersion}</small></td></tr>}
        <tr><td>Risk score</td><td><RiskBadge score={assessment.riskScore} bands={bands} /> <small style={{ color: "var(--muted)" }}>estimate from listed evidence, not a probability</small></td></tr>
        <tr><td>Classification</td><td>{assessment.classification.replace(/_/g, " ")}</td></tr>
        <tr><td>Checked</td><td>{assessment.checkedAt ? assessment.checkedAt.toLocaleString() : "Not yet"}{assessment.datasetVersion && <small style={{ color: "var(--muted)" }}> · dataset {assessment.datasetVersion.slice(0, 19).replace("T", " ")}</small>}</td></tr>
        {(assessment.retryCount > 0 || assessment.nextRetryAt) && <tr><td>Retries</td><td>{assessment.retryCount}{assessment.nextRetryAt && ` · next ${assessment.nextRetryAt.toLocaleString()}`}{assessment.lastError && ` · ${assessment.lastError}`}</td></tr>}
        <tr><td>Grade impact</td><td>{state === "SECURITY_CLEARED" ? "Counts toward the business grade when published" : "Excluded from grades, counts and public pages"}</td></tr>
      </>}
    </tbody></table>
    {assessment && <div style={{ marginTop: 12 }}>
      <strong style={{ fontSize: 12 }}>Evidence</strong>
      {signals.length === 0 ? <p style={{ fontSize: 12, marginTop: 4 }}>No listed signals for this network.</p> :
        <table className="data-table" style={{ marginTop: 6 }}><thead><tr><th>Signal</th><th>Source</th><th>Confidence</th><th>Contribution</th></tr></thead><tbody>
          {signals.map(s => <tr key={s.group + s.code}><td><strong>{s.category}</strong><br /><small>{s.detail}</small></td><td><small>{s.source}</small></td><td>{s.confidence}%</td><td>+{s.contribution}</td></tr>)}
        </tbody></table>}
      <strong style={{ fontSize: 12, display: "block", marginTop: 12 }}>Providers</strong>
      {providers.length === 0 ? <p style={{ fontSize: 12, marginTop: 4 }}>No provider run recorded.</p> :
        <table className="data-table" style={{ marginTop: 6 }}><tbody>
          {providers.map(p => <tr key={p.provider}><td>{p.provider}</td><td><span className={`badge ${p.status === "ok" ? "ok" : p.status === "stale" || p.status === "disabled" || p.status === "unconfigured" ? "warn" : "err"}`}>{p.status}</span></td><td><small>{p.latencyMs} ms{p.error ? ` · ${p.error}` : ""}</small></td></tr>)}
        </tbody></table>}
    </div>}
    {isOwnReview ? <p className="notice warning" style={{ marginTop: 12 }}>You cannot decide on your own review.</p> : <>
      {canDecide && <ActionForm action="admin-security-decision" fixed={{ id: assessment?.reviewId ?? "" }} submitButtons={[
        { name: "decision", value: "clear", label: "Clear & publish", confirm: "Clear this review and publish it? The original assessment stays on record." },
        { name: "decision", value: "hold", label: "Hold for review", className: "button secondary" },
        { name: "decision", value: "reject", label: "Reject", className: "button danger", confirm: "Reject this review? The reviewer will be notified with your reason." },
      ]}>
        <Field label="Reason (recorded in the audit log and shared with the reviewer on reject)" name="reason" minLength={10} maxLength={1000} />
      </ActionForm>}
      {canRecheck && <div style={{ marginTop: 10 }}><ActionForm action="admin-security-recheck" fixed={{ id: assessment?.reviewId ?? "" }} label="Re-run security check" /></div>}
    </>}
    <strong style={{ fontSize: 12, display: "block", marginTop: 14 }}>Security audit history</strong>
    {audit.length === 0 ? <p style={{ fontSize: 12, marginTop: 4 }}>No entries.</p> :
      audit.map(a => <div className="audit-row" key={a.id}><strong>{a.action}</strong> <small>{a.reasonCode}</small><p>{a.previousState ? STATE_LABELS[a.previousState] : "—"} → {a.newState ? STATE_LABELS[a.newState] : "—"}{a.actorId ? "" : " · system"}</p><small>{a.createdAt.toISOString()}</small></div>)}
  </section>;
}

export function SecurityQueueLink({ children }: { children?: React.ReactNode }) {
  return <Link className="text-link" href="/review-matter-panel/security">{children ?? "Open Security Center →"}</Link>;
}
