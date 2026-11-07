"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Upload, X } from "lucide-react";
import { GRADES, POINTS, reviewScore, type Grade } from "@/lib/grades";
import { GradeScale } from "./review-card";
import { actionRequest } from "./forms";

type UploadItem = { id: string; label: string };
export function ReviewForm({ businessId, supportEnabled }: { businessId: string; supportEnabled: boolean }) {
  const [service, setService] = useState<Grade | null>(null), [support, setSupport] = useState<Grade | null>(null);
  const [attachments, setAttachments] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false), [progress, setProgress] = useState(0), [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const score = service && (!supportEnabled || support) ? reviewScore(service, supportEnabled ? support : null) : null;
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    if (files.length + attachments.length > 4) { setError("You can attach up to four images."); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use JPEG, PNG, or WebP images up to 5 MB each.");
        setProgress(0);
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
    setUploading(true); setError("");
    try {
      const response = await fetch(`/api/uploads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error);
      setAttachments(current => current.filter(item => item.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove the image."); }
    finally { setUploading(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (score === null) { setError("Select a grade for each required category."); return; }
    setPending(true);
    try {
      const form = new FormData(event.currentTarget);
      const result = await actionRequest("review-submit", { businessId, headline: form.get("headline"), body: form.get("body"), serviceGrade: service, ...(supportEnabled ? { supportGrade: support } : {}), attachmentIds: attachments.map(a => a.id) });
      router.push(result.redirect || "/account"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Your review could not be submitted."); setPending(false); }
  }
  const picker = (label: string, name: string, selected: Grade | null, select: (grade: Grade) => void) => <fieldset className="grade-picker"><legend>{label} <span aria-hidden="true">*</span></legend><div className="grade-options">{GRADES.map(g => <label className="grade-option" key={g}><input type="radio" name={name} value={g} required checked={selected === g} onChange={() => select(g)} /><span>{g}<small>{POINTS[g]} points</small></span></label>)}</div></fieldset>;
  return <form className="form-stack" onSubmit={submit}><fieldset disabled={pending || uploading}>
    <label className="field"><span>Give your experience a headline</span><input name="headline" required minLength={5} maxLength={120} placeholder="What should other customers know?" /></label>
    <label className="field"><span>Tell your story</span><textarea name="body" required minLength={30} maxLength={5000} rows={6} placeholder="What went well? What could have been better? Keep it specific and based on your own experience." /><small>30–5,000 characters. Don’t include personal or payment information.</small></label>
    {picker("Service Quality", "serviceGrade", service, setService)}
    {supportEnabled && picker("Customer Support", "supportGrade", support, setSupport)}
    {score !== null && <div className="live-score" aria-live="polite"><span>Your overall score<br /><b>{score} / 100</b></span><GradeScale score={score} /></div>}
    <div className="upload-area"><h3><Upload size={16} style={{ verticalAlign: "middle", marginRight: 7 }} />Add context with proof <span className="muted">(optional)</span></h3><p>Up to 4 JPEG, PNG, or WebP images, 5 MB each. Redact personal details, payment information, and order identifiers before sharing. Evidence does not guarantee authenticity.</p><label className="field"><span className="sr-only">Choose optional proof images</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={attachments.length >= 4} onChange={event => { void upload(event.target.files); event.target.value = ""; }} /></label>
      {attachments.length > 0 && <div className="upload-list">{attachments.map(attachment => <div className="upload-item" key={attachment.id}>{
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/evidence/${attachment.id}`} alt={attachment.label} />
      }<button type="button" aria-label="Remove attachment" onClick={() => remove(attachment.id)}><X size={12} /></button></div>)}</div>}
    </div>
    <label className="check-label"><input type="checkbox" required /><span>This review describes my own experience. I have removed private details and agree to the review policy.</span></label>
  </fieldset>
  {uploading && <div role="status"><small>Uploading or processing your image… {progress}%</small><progress max={100} value={progress} /></div>}
  {error && <p className="notice error" role="alert">{error}</p>}
  <button className="button primary" disabled={pending || uploading} type="submit">{pending && <LoaderCircle size={16} className="spin" />}{pending ? "Submitting…" : "Submit review"}</button><small>Reviews publish as soon as an automated integrity check completes — usually immediately. Proof attachments are moderated before they appear publicly.</small>
  </form>;
}
