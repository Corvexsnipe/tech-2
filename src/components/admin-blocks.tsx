import { db } from "@/lib/db";
import { ActionForm, Field } from "./forms";

export function StatusPill({ status }: { status: string }) {
  const tone = status === "PUBLISHED" || status === "RESOLVED" ? "ok"
    : status === "PENDING" || status === "INFO_REQUESTED" || status === "WAITING_OWNER" || status === "OPEN" || status === "IN_PROGRESS" ? "warn"
    : status === "REJECTED" || status === "REMOVED" || status === "CLOSED" ? "err" : "dim";
  return <span className={`badge ${tone}`}>{status.replace(/_/g, " ")}</span>;
}

export async function AdminNotes({ targetType, targetId }: { targetType: string; targetId: string }) {
  const notes = await db().adminNote.findMany({
    where: { targetType, targetId }, include: { author: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" }, take: 50,
  });
  return <section className="panel"><h3>Private staff notes</h3>
    <p style={{ fontSize: 11 }}>Visible only to platform staff. Never shown to the account holder.</p>
    {notes.map(n => <div className="audit-row" key={n.id}><p>{n.body}</p><small>{n.author.displayName} · {n.createdAt.toISOString()}</small></div>)}
    {notes.length === 0 && <p style={{ fontSize: 12 }}>No notes recorded.</p>}
    <ActionForm action="admin-note" fixed={{ targetType, targetId }} label="Add private note">
      <Field label="Note" name="body" minLength={3} maxLength={2000} />
    </ActionForm>
  </section>;
}

export function AssignControl({ action, id, staff, current }: { action: string; id: string; staff: { id: string; displayName: string }[]; current?: string | null }) {
  return <ActionForm action={action} fixed={{ id }} label="Assign case">
    <label className="field"><span>Assigned moderator</span>
      <select name="assigneeId" defaultValue={current || ""}>
        <option value="">Unassigned</option>
        {staff.map(s => <option key={s.id} value={s.id}>{s.displayName}</option>)}
      </select>
    </label>
  </ActionForm>;
}
