import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { ActionForm, Field } from "@/components/forms";
import { AdminNotes, StatusPill } from "@/components/admin-blocks";
import { GRADE_LABELS } from "@/lib/grades";

const BASE = "/review-matter-panel/users";

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await panelUser("MODERATOR");
  const { id } = await params;
  const target = await db().user.findUnique({ where: { id }, include: {
    reviews: { orderBy: { createdAt: "desc" }, take: 30, include: { business: { select: { name: true, slug: true } } } },
    claims: { orderBy: { createdAt: "desc" }, take: 20, include: { business: { select: { name: true } } } },
    reports: { orderBy: { createdAt: "desc" }, take: 20 },
    sessions: { orderBy: { createdAt: "desc" }, take: 10 },
    memberships: { include: { business: { select: { name: true, slug: true } } } },
    _count: { select: { reviews: true, reports: true, claims: true } },
  } });
  if (!target) notFound();
  const history = await db().auditLog.findMany({ where: { targetId: target.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const canAdmin = hasRole(me, "ADMIN"), canSuper = hasRole(me, "SUPER_ADMIN");
  const isSelf = target.id === me.id;

  return <>
    <div className="page-heading"><span className="eyebrow purple">USER RECORD</span><h1>{target.displayName}</h1><p>{target.email} · Joined {target.createdAt.toLocaleDateString()}</p></div>
    <div className="panel-grid-2">
      <section className="panel"><h3>Account</h3>
        <table className="data-table" style={{ marginTop: 12 }}><tbody>
          <tr><td>Role</td><td><span className="badge">{target.role.replace("_", " ")}</span></td></tr>
          <tr><td>Email</td><td>{target.verifiedAt ? "Verified" : "Not verified"}</td></tr>
          <tr><td>Status</td><td>{target.disabledAt ? "Suspended" : "Active"}{target.deletionRequestedAt ? " · deletion requested" : ""}</td></tr>
          <tr><td>Reviews</td><td>{target._count.reviews}</td></tr>
          <tr><td>Reports filed</td><td>{target._count.reports}</td></tr>
          <tr><td>Claims</td><td>{target._count.claims}</td></tr>
          <tr><td>Owns</td><td>{target.memberships.map(m => m.business.name).join(", ") || "—"}</td></tr>
        </tbody></table>
        {canAdmin && !isSelf && target.role !== "SUPER_ADMIN" && <>
          <ActionForm action="admin-user" fixed={{ id: target.id, disabled: !target.disabledAt }} label={target.disabledAt ? "Restore account" : "Suspend account"} confirm={target.disabledAt ? "Restore access?" : "Suspend this account and revoke every session?"}>
            <Field label="Reason" name="reason" minLength={10} maxLength={1000} />
          </ActionForm>
          <ActionForm action="admin-user-sessions" fixed={{ id: target.id }} label="Revoke all sessions" confirm="Sign this account out everywhere?"><span /></ActionForm>
        </>}
        {target.deletionRequestedAt && canAdmin && <div className="notice warning" role="status">This account requested deletion on {target.deletionRequestedAt.toLocaleDateString()}.
          <div className="button-row" style={{ marginTop: 10 }}>
            <ActionForm action="admin-user-delete" fixed={{ id: target.id, mode: "complete" }} label="Anonymize account" confirm="Permanently anonymize this account? The email and name are erased; reviews remain attributed to a deleted user." />
            <ActionForm action="admin-user-delete" fixed={{ id: target.id, mode: "dismiss" }} label="Dismiss request" />
          </div>
        </div>}
        {canSuper && !isSelf && <ActionForm action="admin-role" fixed={{ id: target.id }} label="Change role" confirm="Role changes take effect immediately and are audited.">
          <label className="field"><span>Role</span><select name="role" defaultValue={target.role}>
            <option value="CUSTOMER">Customer</option><option value="MODERATOR">Moderator</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option>
          </select></label>
          <Field label="Reason" name="reason" minLength={10} maxLength={1000} />
        </ActionForm>}
      </section>

      <section className="panel"><h3>Recent sessions</h3>
        {target.sessions.length === 0 ? <p style={{ marginTop: 12 }}>No active sessions.</p> :
          <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Created</th><th>Expires</th></tr></thead><tbody>
            {target.sessions.map(s => <tr key={s.id}><td>{s.createdAt.toLocaleString()}</td><td>{s.expiresAt.toLocaleDateString()}</td></tr>)}
          </tbody></table>}
        <h3 style={{ marginTop: 24 }}>Record history</h3>
        {history.map(log => <div className="audit-row" key={log.id}><strong>{log.action}</strong><p>{log.detail}</p><small>{log.createdAt.toISOString()}</small></div>)}
      </section>
    </div>

    <section className="panel" style={{ marginTop: 16 }}><h3>Review history</h3>
      {target.reviews.length === 0 ? <p style={{ marginTop: 12 }}>No reviews submitted.</p> :
        <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Business</th><th>Headline</th><th>Grade</th><th>Score</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>
          {target.reviews.map(r => <tr key={r.id}>
            <td>{r.business.name}</td><td>{r.headline}</td><td>{GRADE_LABELS[r.serviceGrade]}{r.supportGrade ? ` / ${GRADE_LABELS[r.supportGrade]}` : ""}</td>
            <td>{r.score.toFixed(1)}</td><td><StatusPill status={r.status} /></td><td><small>{r.createdAt.toLocaleDateString()}</small></td>
            <td><Link className="text-link" href={`/review-matter-panel/reviews/${r.id}`}>Open →</Link></td>
          </tr>)}
        </tbody></table>}
    </section>

    <div className="panel-grid-2" style={{ marginTop: 16 }}>
      <section className="panel"><h3>Ownership claims</h3>
        {target.claims.length === 0 ? <p style={{ marginTop: 12 }}>None.</p> : target.claims.map(c =>
          <p key={c.id} style={{ marginTop: 10 }}><Link className="text-link" href={`/review-matter-panel/claims`}>{c.business.name}</Link> — <StatusPill status={c.status} /> <small>{c.createdAt.toLocaleDateString()}</small></p>)}
      </section>
      <section className="panel"><h3>Reports filed</h3>
        {target.reports.length === 0 ? <p style={{ marginTop: 12 }}>None.</p> : target.reports.map(r =>
          <p key={r.id} style={{ marginTop: 10 }}>{r.targetType} report — <StatusPill status={r.status} /> <small>{r.createdAt.toLocaleDateString()}</small></p>)}
      </section>
    </div>
    <div style={{ marginTop: 16 }}><AdminNotes targetType="user" targetId={target.id} /></div>
    <p style={{ marginTop: 18 }}><Link className="text-link" href={BASE}>← Back to users</Link></p>
  </>;
}
