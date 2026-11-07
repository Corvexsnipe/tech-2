import { hasRole, panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { ActionForm, Field } from "@/components/forms";
import { EmptyState } from "@/components/shared";

export default async function Categories() {
  const me = await panelUser("MODERATOR");
  const [categories, usage] = await Promise.all([
    db().category.findMany({ orderBy: { name: "asc" } }),
    db().business.groupBy({ by: ["category"], _count: { _all: true }, orderBy: { _count: { category: "desc" } } }),
  ]);
  const usageByName = new Map(usage.map(u => [u.category, u._count._all]));
  const canAdmin = hasRole(me, "ADMIN");

  return <>
    <div className="page-heading"><span className="eyebrow purple">CATEGORIES</span><h1>Business categories.</h1><p>The managed list below feeds directory filters. Renaming updates every listing in the category in one transaction.</p></div>
    {canAdmin && <section className="panel" style={{ marginBottom: 16 }}><h3>Add category</h3>
      <ActionForm action="admin-category" fixed={{ op: "add" }} label="Add category"><Field label="Category name" name="name" minLength={2} maxLength={60} /></ActionForm>
    </section>}
    {categories.length === 0 ? <EmptyState title="No managed categories yet." description="Businesses currently use free-text categories. Add entries to curate the directory." /> :
      <table className="data-table"><thead><tr><th>Category</th><th>Listings in use</th><th>Managed</th><th></th></tr></thead><tbody>
        {categories.map(c => <tr key={c.id}>
          <td><strong>{c.name}</strong></td>
          <td>{usageByName.get(c.name) || 0}</td>
          <td><small>{c.createdAt.toLocaleDateString()}</small></td>
          <td>{canAdmin && <div className="button-row">
            <ActionForm action="admin-category" fixed={{ op: "rename", id: c.id }} label="Rename"><Field label="New name" name="name" minLength={2} maxLength={60} defaultValue={c.name} /></ActionForm>
            <ActionForm action="admin-category" fixed={{ op: "remove", id: c.id }} label="Remove" confirm="Remove this managed category? Listings keep their existing category text." />
          </div>}</td>
        </tr>)}
      </tbody></table>}
    <section className="panel" style={{ marginTop: 16 }}><h3>Categories in use on listings</h3>
      {usage.length === 0 ? <p style={{ marginTop: 12 }}>No business listings yet.</p> :
        <table className="data-table" style={{ marginTop: 12 }}><thead><tr><th>Category text</th><th>Businesses</th></tr></thead><tbody>
          {usage.map(u => <tr key={u.category}><td>{u.category}</td><td>{u._count._all}</td></tr>)}
        </tbody></table>}
    </section>
  </>;
}
