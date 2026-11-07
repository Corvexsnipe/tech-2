import Link from "next/link";
import { panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/shared";

const ROLE_INFO: Record<string, string> = {
  SUPER_ADMIN: "Full access including scoring rules, roles, and platform settings.",
  ADMIN: "Users, businesses, claims, moderation, reports, exports, and content settings.",
  MODERATOR: "Review, attachment, reply, and report moderation only.",
};

export default async function Team() {
  await panelUser("ADMIN");
  const staff = await db().user.findMany({ where: { role: { in: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] } }, orderBy: { createdAt: "asc" }, select: {
    id: true, displayName: true, email: true, role: true, verifiedAt: true, disabledAt: true, createdAt: true,
    sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    _count: { select: { assignedReviews: true, assignedClaims: true, assignedReports: true } },
  } });

  return <>
    <div className="page-heading"><span className="eyebrow purple">ADMIN TEAM & PERMISSIONS</span><h1>Who can do what.</h1><p>Role changes are made on each user’s record and require Super Admin. Every privileged action is authorized on the server.</p></div>
    {staff.length === 0 ? <EmptyState title="No staff accounts." description="Promote a user from their record page." /> :
      <table className="data-table"><thead><tr><th>Staff member</th><th>Role</th><th>Scope</th><th>Assigned caseload</th><th>Last session</th><th>Status</th><th></th></tr></thead><tbody>
        {staff.map(s => <tr key={s.id}>
          <td><strong>{s.displayName}</strong><br /><small style={{ color: "var(--muted)" }}>{s.email}</small></td>
          <td><span className="badge">{s.role.replace("_", " ")}</span></td>
          <td><small>{ROLE_INFO[s.role]}</small></td>
          <td><small>{s._count.assignedReviews + s._count.assignedClaims + s._count.assignedReports} open items</small></td>
          <td><small>{s.sessions[0] ? s.sessions[0].createdAt.toLocaleDateString() : "Never"}</small></td>
          <td>{s.disabledAt ? <span className="badge err">Suspended</span> : <span className="badge ok">Active</span>}</td>
          <td><Link className="text-link" href={`/review-matter-panel/users/${s.id}`}>Manage →</Link></td>
        </tr>)}
      </tbody></table>}
    <section className="panel" style={{ marginTop: 16 }}><h3>Permission model</h3>
      <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Capability</th><th>Moderator</th><th>Admin</th><th>Super Admin</th></tr></thead><tbody>
        {[["Moderate reviews, replies, attachments", true, true, true], ["Resolve reports & disputes", true, true, true],
          ["View users, businesses, metrics", true, true, true], ["Suspend / restore accounts", false, true, true],
          ["Decide ownership claims, assign owners", false, true, true], ["CSV exports", false, true, true],
          ["Edit email templates & SEO content", false, true, true], ["Change user roles", false, false, true],
          ["Scoring rules & platform policy", false, false, true],
        ].map(([cap, mod, adm, sup]) => <tr key={cap as string}><td>{cap}</td>{[mod, adm, sup].map((v, i) => <td key={i}>{v ? "✓" : "—"}</td>)}</tr>)}
      </tbody></table>
      <p style={{ fontSize: 11, marginTop: 12 }}>Staff cannot moderate their own reviews or approve their own claims. The last Super Admin cannot be demoted. Two-factor authentication is not yet supported — privileged accounts should use long unique passwords.</p>
    </section>
  </>;
}
