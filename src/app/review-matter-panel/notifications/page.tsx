import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { mailConfigured, DEFAULT_TEMPLATES } from "@/lib/mail";
import { ActionForm, Field } from "@/components/forms";
import { EmptyState } from "@/components/shared";

export default async function Notifications() {
  const me = await panelUser("ADMIN");
  const [templates, logs] = await Promise.all([
    db().emailTemplate.findMany({ orderBy: { key: "asc" } }),
    db().emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const overrides = new Map(templates.map(t => [t.key, t]));
  const canSuper = hasRole(me, "SUPER_ADMIN");

  return <>
    <div className="page-heading"><span className="eyebrow purple">NOTIFICATIONS & EMAIL</span><h1>Templates and delivery.</h1><p>Templates support {"{{name}}"} and {"{{url}}"} placeholders. In-app notifications are separate and always sent.</p></div>
    <p className={`notice ${mailConfigured() ? "success" : "warning"}`} role="status">
      SMTP is {mailConfigured() ? "configured — mail will be sent through the connected provider." : "not configured — account emails are blocked until SMTP_HOST and MAIL_FROM are set."} Credentials are never shown here.
    </p>

    <div className="panel-grid-2">
      {Object.entries(DEFAULT_TEMPLATES).map(([key, fallback]) => {
        const t = overrides.get(key);
        return <section className="panel" key={key}><h3>{key === "verify" ? "Email verification" : "Password reset"}</h3>
          <p style={{ fontSize: 11, margin: "6px 0 12px" }}>{fallback.description}{t && <> · customized {t.updatedAt.toLocaleDateString()}</>}</p>
          <ActionForm action="admin-template" fixed={{ key }} label="Save template">
            <Field label="Subject" name="subject" defaultValue={t?.subject || fallback.subject} minLength={3} maxLength={200} />
            <label className="field"><span>Body</span><textarea name="body" rows={7} required minLength={20} maxLength={4000} defaultValue={t?.body || fallback.body} /></label>
          </ActionForm>
          {canSuper && <ActionForm action="admin-template-test" fixed={{ key }} label={`Send test to ${me.email}`} confirm="Send a test email to your own address?" />}
        </section>;
      })}
    </div>

    <section className="panel" style={{ marginTop: 16 }}><h3>Delivery log</h3>
      {logs.length === 0 ? <EmptyState title="No deliveries yet." description="Sent and failed emails will be logged here." /> :
        <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>When</th><th>Kind</th><th>Recipient</th><th>Result</th><th>Detail</th></tr></thead><tbody>
          {logs.map(l => <tr key={l.id}>
            <td><small>{l.createdAt.toLocaleString()}</small></td><td>{l.kind}</td><td>{l.recipient}</td>
            <td><span className={`badge ${l.status === "sent" ? "ok" : "err"}`}>{l.status}</span></td>
            <td><small>{l.detail}</small></td>
          </tr>)}
        </tbody></table>}
    </section>
  </>;
}
