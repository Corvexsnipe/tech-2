"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function BusinessLogo({ business }: { business: { id: string; name: string; logoKey: string | null } }) {
  return business.logoKey ?
    // eslint-disable-next-line @next/next/no-img-element
    <img className="business-monogram" src={`/api/logo/${business.id}?v=${business.logoKey}`} alt={`${business.name} logo`} style={{ objectFit: "cover" }} /> :
    <span className="business-monogram" aria-label={`${business.name} initials`}>{business.name.slice(0, 2).toUpperCase()}</span>;
}
export function LogoUploader({ business }: { business: { id: string; name: string; logoKey: string | null } }) {
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
  const router = useRouter();
  async function update(file?: File) {
    setPending(true); setMessage(""); setError(false);
    try {
      const response = await fetch(`/api/logo/${business.id}`, { method: file ? "POST" : "DELETE", ...(file ? { body: file, headers: { "Content-Type": file.type } } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message); router.refresh();
    } catch (err) { setError(true); setMessage(err instanceof Error ? err.message : "The logo could not be updated."); }
    finally { setPending(false); }
  }
  return <div style={{ marginBottom: 25 }}><div className="profile-title" style={{ marginBottom: 15 }}><BusinessLogo business={business} /><div><h3 style={{ marginBottom: 4 }}>Business logo</h3><p style={{ fontSize: 10 }}>JPEG, PNG, or WebP. Up to 5 MB.</p></div></div><label className="field"><span className="sr-only">Upload a business logo</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={e => { if (e.target.files?.[0]) void update(e.target.files[0]); e.target.value = ""; }} /></label>{business.logoKey && <button className="text-button" disabled={pending} onClick={() => update()}>Remove logo</button>}{pending && <p className="notice" role="status">Processing your logo…</p>}{message && <p className={`notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{message}</p>}</div>;
}
