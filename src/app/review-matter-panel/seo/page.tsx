import { panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { ActionForm, Field } from "@/components/forms";

export default async function Seo() {
  await panelUser("ADMIN");
  const config = await db().platformConfig.upsert({ where: { id: "platform" }, create: { id: "platform" }, update: {} });

  return <>
    <div className="page-heading"><span className="eyebrow purple">SEO & CONTENT</span><h1>Public metadata.</h1><p>These values feed the site title, description, and the optional announcement banner shown site-wide.</p></div>
    <div className="panel-grid-2">
      <section className="panel"><h3>Site metadata</h3>
        <ActionForm action="admin-seo" label="Save metadata">
          <Field label="Site title" name="siteTitle" defaultValue={config.siteTitle} minLength={4} maxLength={120} />
          <label className="field"><span>Meta description</span><textarea name="siteDescription" rows={3} required minLength={20} maxLength={300} defaultValue={config.siteDescription} /></label>
          <label className="field"><span>Announcement banner (optional)</span><input name="announcement" defaultValue={config.announcement || ""} maxLength={300} /><small>Shown at the top of every public page. Leave empty to hide.</small></label>
        </ActionForm>
      </section>
      <section className="panel"><h3>Discovery files</h3>
        <table className="data-table" style={{ marginTop: 12 }}><tbody>
          <tr><td>Canonical domain</td><td><code style={{ fontSize: 11 }}>reviewmatters.org</code></td></tr>
          <tr><td>Sitemap</td><td><a className="text-link" href="/sitemap.xml">/sitemap.xml</a> — generated from public listings</td></tr>
          <tr><td>Robots</td><td><a className="text-link" href="/robots.txt">/robots.txt</a> — blocks panel, account, and API indexing</td></tr>
          <tr><td>Business URLs</td><td>Permanent slugs; name changes never break profile links or QR codes</td></tr>
        </tbody></table>
        <p style={{ fontSize: 11.5, marginTop: 12 }}>Legal pages (Privacy, Terms) are versioned site content — edit them in the codebase under <code style={{ fontSize: 11 }}>src/app/[page]</code>.</p>
      </section>
    </div>
  </>;
}
