"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

export async function actionRequest(action: string, data: Record<string, unknown>) {
  const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result as { message: string; redirect?: string };
}

export function ActionForm({ action, children, label = "Save changes", fixed = {}, booleans = [], numbers = [], className = "", confirm, submitButtons }: {
  action: string; children?: ReactNode; label?: string; fixed?: Record<string, unknown>;
  booleans?: string[]; numbers?: string[]; className?: string; confirm?: string;
  submitButtons?: { name: string; value?: string; label: string; className?: string; confirm?: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const prompt = submitter?.dataset.confirm || confirm;
    if (prompt && !window.confirm(prompt)) return;
    setPending(true); setMessage(""); setError(false);
    const form = new FormData(event.currentTarget, submitter);
    const data: Record<string, unknown> = { ...Object.fromEntries(form), ...fixed };
    booleans.forEach(key => { data[key] = form.has(key); });
    numbers.forEach(key => { data[key] = Number(form.get(key)); });
    try {
      const result = await actionRequest(action, data);
      setMessage(result.message);
      if (result.redirect) router.push(result.redirect);
      router.refresh();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Request failed."); setError(true); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className={`form-stack ${className}`}>
    <fieldset disabled={pending}>{children}</fieldset>
    {message && <p role={error ? "alert" : "status"} className={`notice ${error ? "error" : "success"}`}>{message}</p>}
    {submitButtons ? <div className="button-row" style={{ justifyContent: "flex-start", marginTop: 4 }}>
      {submitButtons.map(b => <button key={`${b.name}:${b.value ?? "on"}`} className={b.className || "button primary"} name={b.name} value={b.value ?? "on"} type="submit" disabled={pending} data-confirm={b.confirm || ""}>{pending ? "Please wait…" : b.label}</button>)}
    </div> :
      <button className="button primary" disabled={pending} type="submit">{pending ? <LoaderCircle size={17} className="spin" /> : null}{pending ? "Please wait…" : label}{!pending && <ArrowRight size={16} />}</button>}
  </form>;
}

export function BulkActionForm({ action, label = "Apply to selected", confirm, children }: { action: string; label?: string; confirm?: string; children?: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ids = form.getAll("ids").map(String).filter(Boolean);
    if (!ids.length) { setMessage("Select at least one record first."); setError(true); return; }
    if (confirm && !window.confirm(confirm)) return;
    setPending(true); setMessage(""); setError(false);
    try {
      const result = await actionRequest(action, { op: form.get("op"), ids, reason: form.get("reason") });
      setMessage(result.message); router.refresh();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Request failed."); setError(true); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit}>
    <div className="panel-bulk">
      <select name="op" required aria-label="Bulk action"><option value="suspend">Suspend</option><option value="restore">Restore</option></select>
      <input name="reason" placeholder="Reason (required)" minLength={10} maxLength={1000} required aria-label="Bulk action reason" />
      <button className="button secondary small" disabled={pending} type="submit">{pending ? "Working…" : label}</button>
      {message && <span role={error ? "alert" : "status"} className={`notice ${error ? "error" : "success"}`} style={{ margin: 0, padding: "6px 10px" }}>{message}</span>}
    </div>
    <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>{children}</fieldset>
  </form>;
}

export function Field({ label, name, type = "text", defaultValue, required = true, minLength, maxLength, hint, autoComplete }: {
  label: string; name: string; type?: string; defaultValue?: string | number; required?: boolean; minLength?: number; maxLength?: number; hint?: string; autoComplete?: string;
}) {
  return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue} required={required} minLength={minLength} maxLength={maxLength} autoComplete={autoComplete} />{hint && <small>{hint}</small>}</label>;
}

export function BusinessFields({ business, websiteRequired = false }: { business?: { name: string; description: string; category: string; city: string; website: string | null; supportEnabled: boolean }; websiteRequired?: boolean }) {
  return <>
    <Field label="Business name" name="name" defaultValue={business?.name} minLength={2} maxLength={100} />
    <label className="field"><span>Description</span><textarea name="description" defaultValue={business?.description} required minLength={20} maxLength={2000} rows={4} /></label>
    <div className="form-row"><Field label="Category" name="category" defaultValue={business?.category} maxLength={60} /><Field label="City or service area" name="city" defaultValue={business?.city} maxLength={100} /></div>
    <Field label={websiteRequired ? "Business website" : "Website (optional)"} name="website" type="url" required={websiteRequired} defaultValue={business?.website || ""} maxLength={500} hint={websiteRequired ? "Required — we verify ownership through the official business site." : undefined} />
    {websiteRequired && <Field label="Business domain" name="domain" defaultValue="" maxLength={253} hint="Just the domain, e.g. caspian.host — your public profile will be reviewmatters.org/review/caspian.host. It must match your website." />}
    <label className="check-label"><input name="supportEnabled" type="checkbox" defaultChecked={business?.supportEnabled ?? true} /><span>Include Customer Support in new reviews<small>Service Quality is always included. Existing scores keep the categories used when submitted.</small></span></label>
  </>;
}

export function CopyButton({ value }: { value: string }) {
  const [message, setMessage] = useState("Copy profile link");
  return <button className="button secondary" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setMessage("Link copied"); }
    catch { setMessage("Copy unavailable — select the link above"); }
  }}>{message}</button>;
}

export function PrintButton() {
  return <button className="button primary no-print" onClick={() => window.print()}>Print QR poster</button>;
}
