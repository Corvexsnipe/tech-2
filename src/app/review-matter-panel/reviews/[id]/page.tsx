import Link from "next/link";
import { notFound } from "next/navigation";
import { panelUser, staffList, REPORT_KIND_LABELS } from "@/lib/admin";
import { db } from "@/lib/db";
import { publicReviewInclude, reviewView } from "@/lib/data";
import { ActionForm, Field } from "@/components/forms";
import { AdminNotes, AssignControl, StatusPill } from "@/components/admin-blocks";
import { ProofViewer, ReviewCard } from "@/components/review-card";
import { GRADE_LABELS, POINTS, fromDbGrade, gradeFor } from "@/lib/grades";
import { hasRole } from "@/lib/admin";
import { securityConfig } from "@/lib/security/config";
import { decryptIp, ipHashes } from "@/lib/security/ip-resolver";
import { AssessmentPanel } from "@/components/security-blocks";

const BASE = "/review-matter-panel/reviews";

function ModerationForm({ id }: { id: string }) {
  return <ActionForm action="admin-moderate" fixed={{ id, type: "review" }} label="Record decision" confirm="Record this moderation decision and notify the reviewer?">
    <label className="field"><span>Decision</span><select name="status" defaultValue="PUBLISHED">
      <option value="PUBLISHED">Publish / restore</option><option value="REJECTED">Reject</option><option value="HIDDEN">Hide temporarily</option><option value="REMOVED">Remove permanently</option>
    </select></label>
    <Field label="Reason (shared with the reviewer)" name="reason" minLength={10} maxLength={1000} />
  </ActionForm>;
}

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await panelUser("MODERATOR");
  const { id } = await params;
  const review = await db().review.findUnique({ where: { id }, include: {
    ...publicReviewInclude,
    attachments: true,
    business: { select: { id: true, name: true, slug: true, supportEnabled: true } },
    user: { select: { id: true, displayName: true, email: true, createdAt: true, _count: { select: { reviews: true } } } },
    assignee: { select: { id: true, displayName: true } },
    reply: true,
    securityAssessment: true,
  } });
  if (!review) notFound();
  const [reports, history, staff, securityAudit] = await Promise.all([
    db().report.findMany({ where: { targetId: review.id, targetType: "review" }, orderBy: { createdAt: "desc" }, include: { user: { select: { displayName: true } } } }),
    db().auditLog.findMany({ where: { targetId: review.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    staffList(),
    db().reviewSecurityAuditLog.findMany({ where: { reviewId: review.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const security = securityConfig();
  // Same-network activity is IP data, so it stays behind the same ADMIN gate
  // as the decrypted IP shown in the assessment panel. The encrypted blob is
  // decrypted once and hashed under every key version so legacy rows match.
  const admin = hasRole(me, "ADMIN");
  const networkIp = admin ? decryptIp(review.securityAssessment?.encryptedIp) : null;
  const networkHashes = networkIp ? ipHashes(networkIp) : review.ipHash ? [review.ipHash] : [];
  const [networkReviews, networkTotal] = admin && networkHashes.length ? await Promise.all([
    db().review.findMany({
      where: { ipHash: { in: networkHashes } },
      include: { business: { select: { name: true, slug: true, domain: true } }, user: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" }, take: 50,
    }),
    db().review.count({ where: { ipHash: { in: networkHashes } } }),
  ]) : [[], 0];
  const networkCount = (s: string[]) => networkReviews.filter(r => s.includes(r.status)).length;

  return <>
    <div className="page-heading"><span className="eyebrow purple">REVIEW RECORD</span><h1>{review.headline}</h1><p>For <Link className="text-link" href={`/review-matter-panel/businesses/${review.businessId}`}>{review.business.name}</Link> by {review.user.displayName} · {review.createdAt.toLocaleString()}</p></div>

    <div className="panel-grid-2">
      <div>
        <ReviewCard review={reviewView(review)} supportEnabled={review.business.supportEnabled} />
        <section className="panel" style={{ marginTop: 16 }}><h3>Score breakdown</h3>
          <table className="data-table" style={{ marginTop: 12 }}><tbody>
            <tr><td>Service Quality</td><td>{GRADE_LABELS[review.serviceGrade]} · {POINTS[fromDbGrade(review.serviceGrade)]} pts</td></tr>
            {review.supportSnapshot && <tr><td>Customer Support</td><td>{review.supportGrade ? `${GRADE_LABELS[review.supportGrade]} · ${POINTS[fromDbGrade(review.supportGrade)]} pts` : "Not provided"}</td></tr>}
            <tr><td><strong>Overall</strong></td><td><strong>{review.score.toFixed(1)} / 100 → {gradeFor(review.score)}</strong></td></tr>
          </tbody></table>
          <p style={{ fontSize: 10.5, marginTop: 10 }}>Categories snapshotted at submission{review.supportSnapshot ? " (support enabled)" : " (support disabled)"} — later business settings never rewrite this score.</p>
        </section>
      </div>

      <div>
        <section className="panel"><h3>Moderation</h3>
          <table className="data-table" style={{ marginTop: 12 }}><tbody>
            <tr><td>Status</td><td><StatusPill status={review.status} />{review.appealedAt && <span className="badge warn" style={{ marginLeft: 6 }}>appealed {review.appealedAt.toLocaleDateString()}</span>}</td></tr>
            <tr><td>Reviewer</td><td><Link className="text-link" href={`/review-matter-panel/users/${review.user.id}`}>{review.user.displayName}</Link> · {review.user.email} · {review.user._count.reviews} reviews</td></tr>
            <tr><td>Assigned</td><td>{review.assignee?.displayName || "Unassigned"}</td></tr>
          </tbody></table>
          {review.appealNote && <p className="notice warning" style={{ marginTop: 12 }}><strong>Reviewer appeal:</strong> {review.appealNote}</p>}
          {review.moderationNote && <p className="notice" style={{ marginTop: 12 }}>Last note: {review.moderationNote}</p>}
          {review.securityState !== "SECURITY_CLEARED" && <p className="notice warning" style={{ marginTop: 12 }}>Publishing is blocked until network security verification clears this review (see below).</p>}
          <div style={{ marginTop: 14 }}><AssignControl action="admin-review-assign" id={review.id} staff={staff} current={review.assigneeId} /></div>
          <div style={{ marginTop: 14 }}>{review.userId === me.id ? <p className="notice warning">You cannot moderate your own review.</p> : <ModerationForm id={review.id} />}</div>
        </section>

        <div style={{ marginTop: 16 }}>
          <AssessmentPanel assessment={review.securityAssessment} state={review.securityState} bands={{ lowRiskMax: security.lowRiskMax, highRiskMin: security.highRiskMin }}
            canDecide={hasRole(me, "ADMIN")} canRecheck={Boolean(review.securityAssessment)} isOwnReview={review.userId === me.id} audit={securityAudit}
            ip={hasRole(me, "ADMIN") ? decryptIp(review.securityAssessment?.encryptedIp) : undefined} />
        </div>

        <section className="panel" style={{ marginTop: 16 }}><h3>Proof attachments</h3>
          {review.attachments.length === 0 ? <p style={{ marginTop: 12 }}>None attached. Evidence is always optional and never proves authenticity.</p> :
            review.attachments.map(a => <div key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div><strong style={{ fontSize: 12.5 }}>{a.label}</strong><br /><small style={{ color: "var(--muted)" }}>{a.mime} · {(a.size / 1024).toFixed(0)} KB</small></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><StatusPill status={a.status} /><ProofViewer attachments={[{ id: a.id, label: a.label }]} /></div>
              </div>
              {a.userId !== me.id && <div style={{ marginTop: 8 }}>
                {a.status !== "PUBLISHED" && <ActionForm action="admin-moderate" fixed={{ id: a.id, type: "attachment", status: "PUBLISHED" }} label="Approve proof" confirm="Approve this proof attachment? It becomes visible on the public review." className="inline-action" />}
                <details style={{ marginTop: 6 }}>
                  <summary className="text-link" style={{ cursor: "pointer", fontSize: 11 }}>Other proof decision (reject / hide / remove)</summary>
                  <ActionForm action="admin-moderate" fixed={{ id: a.id, type: "attachment" }} label="Record decision" confirm="Record this attachment decision and notify the uploader?" className="inline-action">
                    <label className="field"><span>Decision</span><select name="status" defaultValue="REJECTED"><option value="REJECTED">Reject</option><option value="HIDDEN">Hide</option><option value="REMOVED">Remove</option></select></label>
                    <Field label="Reason (shared with the uploader)" name="reason" minLength={10} maxLength={1000} />
                  </ActionForm>
                </details>
              </div>}
            </div>)}
        </section>

        {admin && networkReviews.length > 0 && <section className="panel" style={{ marginTop: 16 }}><h3>Reviewer network activity</h3>
          <p style={{ marginTop: 10, fontSize: 12 }}>
            {networkIp ? <>Reviews submitted from <code>{networkIp}</code> across the platform</> : "Reviews submitted from this reviewer network across the platform"}:
            <strong> {networkTotal} total</strong> · {networkCount(["PUBLISHED"])} published · {networkCount(["PENDING", "INFO_REQUESTED"])} pending · {networkCount(["REJECTED"])} rejected · {networkCount(["HIDDEN"])} hidden · {networkCount(["REMOVED"])} removed
          </p>
          <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Review</th><th>Business</th><th>By</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
            {networkReviews.map(r => <tr key={r.id}>
              <td><Link className="text-link" href={`${BASE}/${r.id}`}>{r.id === review.id ? "This review" : r.headline}</Link></td>
              <td>{r.business.name}</td>
              <td>{r.user.displayName}</td>
              <td><StatusPill status={r.status} /></td>
              <td><small>{r.createdAt.toLocaleDateString()}</small></td>
            </tr>)}
          </tbody></table>
          <p style={{ fontSize: 10.5, marginTop: 10, color: "var(--muted)" }}>Multiple accounts or many published reviews from one network are a common abuse signal — weigh before approving.</p>
        </section>}

        {review.reply && <section className="panel" style={{ marginTop: 16 }}><h3>Business reply</h3>
          <p style={{ marginTop: 10 }}>{review.reply.body}</p>
          <p style={{ marginTop: 8 }}><StatusPill status={review.reply.status} /></p>
          <ActionForm action="admin-moderate" fixed={{ id: review.reply.id, type: "reply" }} label="Moderate reply">
            <label className="field"><span>Decision</span><select name="status" defaultValue="PUBLISHED"><option value="PUBLISHED">Publish</option><option value="REJECTED">Reject</option><option value="HIDDEN">Hide</option><option value="REMOVED">Remove</option></select></label>
            <Field label="Reason" name="reason" minLength={10} maxLength={1000} />
          </ActionForm>
        </section>}
      </div>
    </div>

    <div className="panel-grid-2" style={{ marginTop: 16 }}>
      <section className="panel"><h3>Report history</h3>
        {reports.length === 0 ? <p style={{ marginTop: 12 }}>No reports filed against this review.</p> :
          reports.map(r => <div className="audit-row" key={r.id}><strong>{REPORT_KIND_LABELS[r.kind] || r.kind}</strong><p>{r.reason}</p><small>{r.user.displayName} · {r.createdAt.toLocaleDateString()} · <StatusPill status={r.status} />{r.resolution ? ` · ${r.resolution}` : ""}</small></div>)}
      </section>
      <section className="panel"><h3>Action history</h3>
        {history.length === 0 ? <p style={{ marginTop: 12 }}>No recorded actions.</p> :
          history.map(log => <div className="audit-row" key={log.id}><strong>{log.action}</strong><p>{log.detail}</p><small>{log.createdAt.toISOString()}</small></div>)}
      </section>
    </div>
    <div style={{ marginTop: 16 }}><AdminNotes targetType="review" targetId={review.id} /></div>
    <p style={{ marginTop: 18 }}><Link className="text-link" href={BASE}>← Back to review queues</Link></p>
  </>;
}
