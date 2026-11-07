import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser } from "@/lib/security";
import { db } from "@/lib/db";
import { ActionForm, BusinessFields } from "@/components/forms";
import { PageHeading } from "@/components/shared";
import { DashboardNav } from "@/components/shell";

export const metadata = { title: "Register or claim a business", robots: { index: false, follow: false } };
export default async function Claim({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const user = await pageUser();
  const businessId = (await searchParams).business;
  const business = businessId ? await db().business.findUnique({ where: { id: businessId }, include: { members: true } }) : null;
  if (businessId && (!business || business.disabledAt)) notFound();
  return <div className="page-main"><div className="container"><PageHeading eyebrow="GIVE YOUR REPUTATION A HOME" title={business ? `Claim ${business.name}` : "Register your business."} description={business ? "This business is already listed. Prove your connection to manage it." : "Start with your business details. An administrator will verify your authority before granting dashboard access."} /><DashboardNav /><div className="dashboard-grid"><section className="panel">
    {!user.verifiedAt ? <p className="notice warning">Please <Link href="/resend-verification">verify your email</Link> before submitting a claim.</p> : business?.members.length ? <p className="notice">This business already has an owner. Contact the platform team if you need an ownership change.</p> : <ActionForm action="business-claim" label="Submit ownership request" booleans={["supportEnabled"]} fixed={businessId ? { businessId } : {}}>
      {business ? <div className="notice"><strong>{business.name}</strong> — {business.category}, {business.city}. Claiming this listing does not change its published details; only an approved owner can edit them.</div> : <BusinessFields websiteRequired />}
      <label className="field"><span>How can we verify your ownership?</span><textarea name="evidence" rows={5} required minLength={30} maxLength={3000} placeholder="Describe your role, your connection to the business, and a publicly verifiable way to confirm it (for example, your role on the official website)." /><small>Private to administrators. Do not include passwords, payment details, or identity document numbers.</small></label><label className="check-label"><input type="checkbox" required /><span>I am authorized to represent this business and the information above is accurate.</span></label></ActionForm>}
    </section><aside className="panel"><h2>A little verification. A fairer platform.</h2><p>Submitting this form creates a pending claim. It does not automatically verify ownership or make an unapproved profile public.</p><div className="auth-points"><span>01 · Submit your business details</span><span>02 · Administrator checks your authority</span><span>03 · Access your profile, replies, and QR code</span></div><p style={{ marginTop: 25 }}>Already listed? Find the existing profile first to avoid duplicate businesses.</p><Link href="/explore" className="text-link">Search the directory →</Link></aside></div></div></div>;
}
