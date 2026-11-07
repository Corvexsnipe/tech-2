import Link from "next/link";
import { Status } from "@prisma/client";
import { panelUser, staffList } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { ActionForm, Field } from "@/components/forms";
import { EmptyState, Pagination } from "@/components/shared";
import { AssignControl, StatusPill } from "@/components/admin-blocks";

const BASE = "/review-matter-panel/claims";
const TABS: [Status, string][] = [["PENDING", "Pending"], ["INFO_REQUESTED", "Info requested"], ["PUBLISHED", "Approved"], ["REJECTED", "Rejected"]];

export default async function Claims({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await panelUser("ADMIN");
  const params = await searchParams;
  const status: Status = TABS.some(([s]) => s === params.status) ? params.status as Status : "PENDING";
  const page = pageNumber(params.page), take = 15, skip = (page - 1) * take;
  const [claims, count, staff] = await Promise.all([
    db().claim.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take, skip, include: {
      business: { include: { members: { select: { userId: true } }, claims: { where: { status: { in: ["PENDING", "INFO_REQUESTED"] } }, select: { id: true, userId: true } } } },
      user: { select: { id: true, displayName: true, email: true, verifiedAt: true, disabledAt: true, createdAt: true, _count: { select: { claims: true } } } },
      assignee: { select: { id: true, displayName: true } },
    } }),
    db().claim.count({ where: { status } }),
    staffList(),
  ]);

  return <>
    <div className="page-heading"><span className="eyebrow purple">BUSINESS CLAIMS</span><h1>Ownership verification.</h1><p>Grant dashboard access only after independently verifying the claimant’s authority through an official business channel.</p></div>
    <div className="panel-tabs">{TABS.map(([s, label]) => <Link key={s} href={`${BASE}?status=${s}`} className={status === s ? "active" : ""}>{label}</Link>)}</div>
    {count === 0 ? <EmptyState title="This queue is clear." description="Ownership requests will appear here." /> :
      claims.map(c => {
        const rivals = c.business.claims.filter(other => other.userId !== c.userId).length;
        const signals = [
          c.user._count.claims > 1 ? `Claimant has ${c.user._count.claims} total claims` : null,
          rivals ? `${rivals} other open claim(s) for this business` : null,
          !c.user.verifiedAt ? "Email not verified" : null,
          c.user.disabledAt ? "Account suspended" : null,
        ].filter(Boolean);
        return <article className="admin-card" key={c.id}>
          <div className="admin-card-head"><h3><Link className="text-link" href={`/review-matter-panel/businesses/${c.businessId}`}>{c.business.name}</Link></h3><StatusPill status={c.status} /></div>
          <small><Link className="text-link" href={`/review-matter-panel/users/${c.user.id}`}>{c.user.displayName}</Link> · {c.user.email} · {c.user.verifiedAt ? "Email verified" : "Email unverified"} · filed {c.createdAt.toLocaleDateString()}</small>
          <p style={{ marginTop: 10 }}>{c.business.description}</p>
          <p style={{ fontSize: 12 }}>{c.business.city} · {c.business.category}{c.business.website && <> · <a className="text-link" href={c.business.website} target="_blank" rel="noopener noreferrer">Business website ↗</a></>}</p>
          <p style={{ marginTop: 10 }}><strong>Private ownership statement:</strong><br />{c.evidence}</p>
          {signals.length > 0 && <p className="notice warning">Signals: {signals.join(" · ")}. Signals flag attention — they do not prove a claim is false.</p>}
          {c.assignee && <p style={{ fontSize: 11.5 }}>Assigned to {c.assignee.displayName}</p>}
          {c.decision && <p className="notice">Decision: {c.decision}</p>}
          {(c.status === "PENDING" || c.status === "INFO_REQUESTED") && <>
            <AssignControl action="admin-claim-assign" id={c.id} staff={staff} current={c.assigneeId} />
            <div className="button-row" style={{ justifyContent: "flex-start", margin: "10px 0" }}>
              <ActionForm action="admin-domain-proof" fixed={{ claimId: c.id }} label="Provide domain proof" className="inline-action" confirm={`Email ${c.user.email} a domain-verification code for ${c.business.name}? The claim moves to “Info requested”.`} />
              {c.domainProofSentAt && <small style={{ color: "var(--muted)", alignSelf: "center" }}>Domain proof sent {c.domainProofSentAt.toLocaleDateString()}</small>}
            </div>
            <ActionForm action="admin-claim" fixed={{ id: c.id }} booleans={["approve", "requestInfo"]} submitButtons={[
              { name: "approve", label: "Approve ownership", className: "button primary small", confirm: "Approve only after independently verifying the claimant’s authority. This grants full business dashboard access and is audited." },
              { name: "requestInfo", label: "Request more info", className: "button secondary small" },
              { name: "reject", label: "Reject claim", className: "button danger small", confirm: "Reject this ownership claim? The claimant will be notified with your reason." },
            ]}>
              <Field label="Verification method, rejection reason, or information needed" name="reason" minLength={10} maxLength={1000} />
            </ActionForm>
          </>}
        </article>;
      })}
    <Pagination base={BASE} query={{ status }} page={page} total={count} pageSize={take} />
  </>;
}
