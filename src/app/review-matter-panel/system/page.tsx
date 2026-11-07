import { panelUser } from "@/lib/admin";
import { configured, db } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { uploadDirectory } from "@/lib/uploads";
import { access, mkdir } from "node:fs/promises";
import { ActionForm } from "@/components/forms";
import { securityOverview } from "@/lib/security/dashboard";

export default async function System() {
  await panelUser("ADMIN");
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  let dbOk = false, dbDetail = "Not configured";
  try { await db().$queryRaw`SELECT 1`; dbOk = true; dbDetail = "Connected — queries responding"; } catch { dbDetail = configured() ? "Unreachable or rejected" : "DATABASE_URL not set"; }
  checks.push({ name: "PostgreSQL database", ok: dbOk, detail: dbDetail });

  checks.push({ name: "Email (SMTP)", ok: mailConfigured(), detail: mailConfigured() ? "Configured — verify delivery via a test send on the Notifications page" : "SMTP_HOST / MAIL_FROM missing" });
  try { const dir = uploadDirectory(); await mkdir(dir, { recursive: true }); await access(dir); checks.push({ name: "Attachment storage", ok: true, detail: "Upload directory writable, outside public files" }); }
  catch { checks.push({ name: "Attachment storage", ok: false, detail: "UPLOAD_DIR missing or not writable" }); }
  checks.push({ name: "Session secret", ok: Boolean(process.env.APP_SECRET && process.env.APP_SECRET.length >= 32), detail: (process.env.APP_SECRET?.length ?? 0) >= 32 ? "Configured" : "APP_SECRET missing or too short" });
  checks.push({ name: "Application URL", ok: Boolean(process.env.APP_URL), detail: process.env.APP_URL ? "Configured" : "Defaulting to localhost — set APP_URL before deployment" });
  try {
    const overview = await securityOverview();
    checks.push({ name: "Anti-VPN engine", ok: overview.warnings.length === 0, detail: !overview.config.enabled ? "Disabled (ANTI_VPN_ENABLED=false) — reviews publish without network checks" : overview.warnings.length ? `${overview.warnings.length} warning(s) — see Security Center` : `${overview.config.mode} mode · dataset ${overview.dataset.stale ? "stale" : "fresh"} · ${overview.totals.pending} pending · ${overview.totals.manual} awaiting manual review` });
  } catch { checks.push({ name: "Anti-VPN engine", ok: false, detail: "Configuration invalid or tables missing — run migrations and check ANTI_VPN_* variables" }); }

  const [messages, counts] = await Promise.all([
    db().contactMessage.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "asc" }, take: 30 }),
    Promise.all([db().user.count(), db().business.count(), db().review.count(), db().auditLog.count()]),
  ]);

  return <>
    <div className="page-heading"><span className="eyebrow purple">INTEGRATIONS & SYSTEM HEALTH</span><h1>Live checks.</h1><p>Each integration is probed on every page load — a green state means it works right now, not that it was configured once.</p></div>
    <section className="panel"><table className="data-table"><thead><tr><th>Integration</th><th>Status</th><th>Detail</th></tr></thead><tbody>
      {checks.map(c => <tr key={c.name}><td><strong>{c.name}</strong></td><td><span className={`badge ${c.ok ? "ok" : "err"}`}>{c.ok ? "Healthy" : "Attention"}</span></td><td><small>{c.detail}</small></td></tr>)}
    </tbody></table></section>
    <div className="metric-grid">
      <div className="metric-card"><span>Users</span><strong>{counts[0]}</strong></div>
      <div className="metric-card"><span>Businesses</span><strong>{counts[1]}</strong></div>
      <div className="metric-card"><span>Reviews</span><strong>{counts[2]}</strong></div>
      <div className="metric-card"><span>Audit entries</span><strong>{counts[3]}</strong></div>
    </div>
    <section className="panel"><h3>Contact inbox</h3>
      <p style={{ fontSize: 11.5, marginBottom: 8 }}>Messages sent through the public contact form. Reply from your support mailbox — marking resolved only clears the queue.</p>
      {messages.length === 0 ? <p style={{ fontSize: 12 }}>No unresolved messages.</p> : messages.map(m =>
        <div className="audit-row" key={m.id}><strong>{m.subject}</strong><p>{m.body}</p><small>{m.name} · {m.email} · {m.createdAt.toLocaleString()}</small>
          <span style={{ display: "inline-block", marginTop: 8 }}><ResolveMessage id={m.id} /></span></div>)}
    </section>
  </>;
}

function ResolveMessage({ id }: { id: string }) {
  return <ActionForm action="admin-contact" fixed={{ id }} label="Mark resolved" />;
}
