import { pageUser } from "@/lib/security";
import { ActionForm, Field } from "@/components/forms";
import { DashboardNav } from "@/components/shell";
import { PageHeading } from "@/components/shared";
import Link from "next/link";
export const metadata = { title: "Account settings", robots: { index: false, follow: false } };
export default async function Settings() {
  const user = await pageUser();
  return <div className="page-main"><div className="container"><PageHeading eyebrow="MAKE YOURSELF AT HOME" title="Account settings" description="Manage your public name and keep your account secure." /><DashboardNav /><div className="dashboard-grid"><div><section className="panel"><h2>Public profile</h2><ActionForm action="account-update"><Field label="Display name" name="displayName" defaultValue={user.displayName} minLength={2} maxLength={60} hint="Shown beside your customer reviews." /></ActionForm></section><section className="panel"><h2>Change password</h2><ActionForm action="password-change" label="Update password"><Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" /><Field label="New password" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" hint="At least 12 characters. Changing your password signs out other sessions." /></ActionForm></section></div><aside className="panel"><h2>Account details</h2><p>{user.email}</p><p style={{ marginTop: 10 }}><span className={`status-pill ${user.verifiedAt ? "status-published" : "status-pending"}`}>{user.verifiedAt ? "Email verified" : "Verification pending"}</span></p><p style={{ marginTop: 18 }}>To change your email or request a data export, contact the platform team. We’ll verify your identity before making sensitive changes.</p><Link href="/contact" className="text-link">Contact the team →</Link>
        <div style={{ marginTop: 22, borderTop: "1px solid var(--line)", paddingTop: 18 }}><h3 style={{ fontSize: 15 }}>Delete account</h3>
          {user.deletionRequestedAt ? <p className="notice" role="status" style={{ marginTop: 8 }}>A deletion request is pending administrator review.</p> :
            <ActionForm action="account-deletion-request" label="Request deletion" confirm="Request permanent deletion? An administrator will anonymize your account. Your published reviews stay visible under a deleted-user name.">
              <label className="field"><span>Reason</span><textarea name="reason" required minLength={10} maxLength={2000} rows={3} /></label>
            </ActionForm>}
        </div></aside></div></div></div>;
}
