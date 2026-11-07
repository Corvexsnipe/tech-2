import Link from "next/link";
import { Status } from "@prisma/client";
import { panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { ActionForm, Field } from "@/components/forms";
import { EmptyState, Pagination } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";
import { ProofViewer } from "@/components/review-card";

const BASE = "/review-matter-panel/attachments";
const TABS: [Status, string][] = [["PENDING", "Pending"], ["PUBLISHED", "Published"], ["REJECTED", "Rejected"], ["HIDDEN", "Hidden"], ["REMOVED", "Removed"]];

export default async function Attachments({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const me = await panelUser("MODERATOR");
  const params = await searchParams;
  const status: Status = TABS.some(([s]) => s === params.status) ? params.status as Status : "PENDING";
  const page = pageNumber(params.page), take = 15, skip = (page - 1) * take;
  const [config, attachments, count] = await Promise.all([
    db().platformConfig.findUnique({ where: { id: "platform" } }),
    db().attachment.findMany({ where: { status, reviewId: { not: null } }, orderBy: { createdAt: "asc" }, take, skip, include: {
      review: { select: { id: true, headline: true, status: true, business: { select: { name: true } } } },
      user: { select: { displayName: true, email: true } },
    } }),
    db().attachment.count({ where: { status, reviewId: { not: null } } }),
  ]);

  return <>
    <div className="page-heading"><span className="eyebrow purple">PROOF ATTACHMENTS</span><h1>Evidence review.</h1><p>Check for exposed personal or payment details before publishing. Evidence is optional and never proves authenticity on its own.</p></div>
    <div className="panel-tabs">{TABS.map(([s, label]) => <Link key={s} href={`${BASE}?status=${s}`} className={status === s ? "active" : ""}>{label}</Link>)}</div>
    <p className="notice" role="status">Current upload policy: up to {config?.maxAttachments ?? 4} images, {(config?.maxAttachmentBytes ?? 5242880) / 1048576} MB each, JPEG/PNG/WebP only, metadata stripped server-side. Manage limits under <Link className="text-link" href="/review-matter-panel/settings">Platform Settings</Link>.</p>
    {count === 0 ? <EmptyState title="Queue clear." description="Attachments in this state will appear here." /> :
      attachments.map(a => <article className="admin-card" key={a.id}>
        <div className="admin-card-head"><h3>{a.label}</h3><StatusPill status={a.status} /></div>
        <small>On <Link className="text-link" href={`/review-matter-panel/reviews/${a.review!.id}`}>{a.review!.headline}</Link> · {a.review!.business.name} · by {a.user.displayName} · {a.mime} · {(a.size / 1024).toFixed(0)} KB</small>
        <div style={{ marginTop: 12 }}><ProofViewer attachments={[{ id: a.id, label: a.label }]} /></div>
        {a.userId !== me.id && <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {a.status !== "PUBLISHED" && <div><ActionForm action="admin-moderate" fixed={{ id: a.id, type: "attachment", status: "PUBLISHED" }} label="Approve proof" confirm="Approve this proof attachment? It becomes visible on the public review." /></div>}
          <ActionForm action="admin-moderate" fixed={{ id: a.id, type: "attachment" }} label="Record decision" confirm="Record this attachment decision and notify the uploader?">
            <label className="field"><span>Decision</span><select name="status" defaultValue="REJECTED"><option value="REJECTED">Reject</option><option value="HIDDEN">Hide</option><option value="REMOVED">Remove (privacy or rights concern)</option>{a.status !== "PUBLISHED" && <option value="PUBLISHED">Publish</option>}</select></label>
            <Field label="Reason (shared with the uploader)" name="reason" minLength={10} maxLength={1000} />
          </ActionForm>
        </div>}
      </article>)}
    <Pagination base={BASE} query={{ status }} page={page} total={count} pageSize={take} />
  </>;
}
