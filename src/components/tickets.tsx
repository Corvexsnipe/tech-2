"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Upload, X } from "lucide-react";
import { actionRequest } from "./forms";
import { TICKET_CATEGORIES } from "@/lib/validation";

type UploadItem = { id: string; label: string };

function AttachmentPicker({ attachments, setAttachments, setError }: {
  attachments: UploadItem[]; setAttachments: (fn: (list: UploadItem[]) => UploadItem[]) => void; setError: (m: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    if (files.length + attachments.length > 4) { setError("You can attach up to four images."); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use JPEG, PNG, or WebP images up to 5 MB each.");
        const result = await new Promise<UploadItem>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/uploads");
          xhr.setRequestHeader("Content-Type", file.type);
          xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
          xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || "Upload failed.")); } catch { reject(new Error("Upload failed. Try again.")); } };
          xhr.onerror = () => reject(new Error("Upload interrupted. Check your connection."));
          xhr.send(file);
        });
        setAttachments(current => [...current, result]);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed."); }
    finally { setUploading(false); }
  }
  async function remove(id: string) {
    try {
      const response = await fetch(`/api/uploads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error);
      setAttachments(current => current.filter(item => item.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove the image."); }
  }
  return <div className="upload-area">
    <h3><Upload size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />Attachments <span className="muted">(optional)</span></h3>
    <p>Up to 4 JPEG, PNG, or WebP images, 5 MB each — screenshots or other supporting evidence. Remove private details before sharing.</p>
    <label className="field"><span className="sr-only">Choose attachments</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={attachments.length >= 4 || uploading} onChange={event => { void upload(event.target.files); event.target.value = ""; }} /></label>
    {uploading && <p role="status"><small>Uploading… {progress}%</small></p>}
    {attachments.length > 0 && <div className="upload-list">{attachments.map(a => <div className="upload-item" key={a.id}>{
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/evidence/${a.id}`} alt={a.label} />
    }<button type="button" aria-label="Remove attachment" onClick={() => remove(a.id)}><X size={12} /></button></div>)}</div>}
  </div>;
}

export function TicketCreateForm({ businesses }: { businesses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [attachments, setAttachments] = useState<UploadItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setPending(true);
    try {
      const form = new FormData(event.currentTarget);
      const result = await actionRequest("ticket-create", {
        subject: form.get("subject"), category: form.get("category"), body: form.get("body"),
        ...(form.get("businessId") ? { businessId: form.get("businessId") } : {}),
        attachmentIds: attachments.map(a => a.id),
      });
      setMessage(result.message);
      router.push(result.redirect || "/dashboard/support"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Your ticket could not be created."); setPending(false); }
  }
  return <form className="form-stack" onSubmit={submit}><fieldset disabled={pending}>
    <label className="field"><span>Subject</span><input name="subject" required minLength={5} maxLength={150} placeholder="What do you need help with?" /></label>
    <label className="field"><span>Category</span><select name="category" required defaultValue=""><option value="" disabled>Select a category…</option>{TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
    {businesses.length > 0 && <label className="field"><span>Related business (optional)</span><select name="businessId" defaultValue=""><option value="">None — this is about my account</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
    <label className="field"><span>Describe the issue</span><textarea name="body" required minLength={10} maxLength={5000} rows={7} placeholder="Include dates, links, or anything that helps us investigate. Never share passwords or payment details." /></label>
    <AttachmentPicker attachments={attachments} setAttachments={setAttachments} setError={setError} />
  </fieldset>
    {message && <p role="status" className="notice success">{message}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <button className="button primary" disabled={pending} type="submit">{pending ? <LoaderCircle size={17} className="spin" /> : null}{pending ? "Creating ticket…" : "Create ticket"}{!pending && <ArrowRight size={16} />}</button>
  </form>;
}

export function TicketReplyForm({ ticketId, closed, internal = false }: { ticketId: string; closed?: boolean; internal?: boolean }) {
  const router = useRouter();
  const [attachments, setAttachments] = useState<UploadItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (closed) return <p className="notice">This ticket is closed. <Link className="text-link" href="/dashboard/support/new">Open a new ticket</Link> if you need further help.</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setPending(true);
    // Capture the form element now — currentTarget is cleared after dispatch.
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      const result = await actionRequest(internal ? "admin-ticket-reply" : "ticket-reply", {
        id: ticketId, body: form.get("body"), internal: form.has("internal"), attachmentIds: attachments.map(a => a.id),
      });
      setMessage(result.message); setAttachments([]); formEl.reset(); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Your reply could not be sent."); }
    finally { setPending(false); }
  }
  return <form className="form-stack" onSubmit={submit}><fieldset disabled={pending}>
    <label className="field"><span>{internal ? "Reply or internal note" : "Your reply"}</span><textarea name="body" required minLength={5} maxLength={5000} rows={5} placeholder={internal ? "Reply to the business owner, or tick the box below for a staff-only note." : "Add details or answer the questions from our team."} /></label>
    {internal && <label className="check-label"><input type="checkbox" name="internal" /><span>Internal note — visible to staff only<small>Never shown to the business owner and never emailed to them.</small></span></label>}
    <AttachmentPicker attachments={attachments} setAttachments={setAttachments} setError={setError} />
  </fieldset>
    {message && <p role="status" className="notice success">{message}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <button className="button primary" disabled={pending} type="submit">{pending ? <LoaderCircle size={17} className="spin" /> : null}{pending ? "Sending…" : "Send reply"}{!pending && <ArrowRight size={16} />}</button>
  </form>;
}
