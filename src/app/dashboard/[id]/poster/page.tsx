import { notFound } from "next/navigation";
import { db, canonicalProfile } from "@/lib/db";
import { pageUser } from "@/lib/security";
import { PrintButton } from "@/components/forms";
import { Brand } from "@/components/shell";
export const metadata = { title: "Print QR poster", robots: { index: false, follow: false } };
export default async function Poster({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser();
  const business = await db().business.findUnique({ where: { id: (await params).id }, include: { members: { where: { userId: user.id } } } });
  if (!business || business.disabledAt || !user.verifiedAt || (user.role !== "ADMIN" && !business.members.length)) notFound();
  return <div className="page-main"><div className="container"><div className="poster"><Brand /><h1>Every Review Matters.</h1><h2>{business.name}</h2><p>Scan to Review This Business on Review Matters.</p>{
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/qr/${business.id}`} width={350} height={350} alt={`Scan to open ${business.name}'s public profile`} />
  }<p>Real experiences. Clear grades. Better decisions.</p><span className="qr-link">{canonicalProfile(business)}</span><PrintButton /></div></div></div>;
}
