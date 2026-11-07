import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { minimumReviews } from "@/lib/data";
import { ActionForm, Field } from "@/components/forms";

export default async function Settings() {
  const me = await panelUser("ADMIN");
  const config = await db().platformConfig.upsert({ where: { id: "platform" }, create: { id: "platform" }, update: {} });
  const canSuper = hasRole(me, "SUPER_ADMIN");

  return <>
    <div className="page-heading"><span className="eyebrow purple">PLATFORM SETTINGS</span><h1>Policy & limits.</h1><p>Changes are applied immediately and recorded in the audit log. Scoring rules themselves are fixed by policy.</p></div>
    <div className="panel-grid-2">
      <section className="panel"><h3>Reputation policy</h3>
        <p style={{ fontSize: 11.5, margin: "8px 0 14px" }}>Grade points (A+ 100, A 80, B 70, C 50, D 15) and thresholds are fixed platform constants — only Super Admin can change the publication threshold below. Historical review scores are never recalculated silently.</p>
        {canSuper ? <ActionForm action="admin-config" numbers={["minimumReviews"]} label="Save policy"><Field label="Minimum published reviews for a public grade (3–100)" name="minimumReviews" type="number" defaultValue={config.minimumReviews} /></ActionForm>
          : <p className="notice">Current minimum: {await minimumReviews()} published reviews. Super Admin required to change.</p>}
      </section>

      <section className="panel"><h3>Submission controls</h3>
        <ActionForm action="admin-settings" booleans={["readOnly"]} numbers={["maxAttachments", "maxAttachmentBytes"]} label="Save limits">
          <Field label="Max proof attachments per review (1–8)" name="maxAttachments" type="number" defaultValue={config.maxAttachments} />
          <Field label="Max attachment size in bytes (max 10485760)" name="maxAttachmentBytes" type="number" defaultValue={config.maxAttachmentBytes} />
          <label className="check-label"><input type="checkbox" name="readOnly" defaultChecked={config.readOnly} /><span>Read-only mode<small>Blocks new reviews, claims, and reports platform-wide. Existing content stays public.</small></span></label>
        </ActionForm>
      </section>
    </div>
    <section className="panel" style={{ marginTop: 16 }}><h3>Retention & privacy</h3>
      <p style={{ fontSize: 12 }}>Attachment retention and backup scheduling run through <code style={{ fontSize: 11 }}>npm run maintenance</code> and the database provider. Removed attachments are excluded from public serving immediately; physical file deletion follows the retention job.</p>
    </section>
  </>;
}
