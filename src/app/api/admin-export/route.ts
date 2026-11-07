import { NextResponse } from "next/server";
import { currentUser } from "@/lib/security";
import { isStaff, requireRole, toCsv } from "@/lib/admin";
import { db } from "@/lib/db";
import { AppError } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user || !isStaff(user)) throw new AppError("Administrator access is required.", 403);
    requireRole(user, "ADMIN");
    const kind = new URL(request.url).searchParams.get("kind");
    let csv: string, name: string;
    if (kind === "users") {
      const rows = await db().user.findMany({ orderBy: { createdAt: "desc" }, take: 5000,
        select: { id: true, displayName: true, email: true, role: true, verifiedAt: true, disabledAt: true, createdAt: true } });
      csv = toCsv(["id", "display_name", "email", "role", "verified_at", "suspended_at", "created_at"],
        rows.map(r => [r.id, r.displayName, r.email, r.role, r.verifiedAt?.toISOString(), r.disabledAt?.toISOString(), r.createdAt.toISOString()]));
      name = "users";
    } else if (kind === "reviews") {
      const rows = await db().review.findMany({ orderBy: { createdAt: "desc" }, take: 5000,
        select: { id: true, headline: true, status: true, score: true, serviceGrade: true, supportGrade: true, supportSnapshot: true, createdAt: true, business: { select: { name: true } }, user: { select: { displayName: true } } } });
      csv = toCsv(["id", "business", "author", "headline", "service_grade", "support_grade", "score", "status", "created_at"],
        rows.map(r => [r.id, r.business.name, r.user.displayName, r.headline, r.serviceGrade, r.supportGrade, r.score.toFixed(1), r.status, r.createdAt.toISOString()]));
      name = "reviews";
    } else if (kind === "businesses") {
      const rows = await db().business.findMany({ orderBy: { createdAt: "desc" }, take: 5000,
        select: { id: true, name: true, slug: true, category: true, city: true, website: true, supportEnabled: true, disabledAt: true, createdAt: true } });
      csv = toCsv(["id", "name", "slug", "category", "city", "website", "support_enabled", "disabled_at", "created_at"],
        rows.map(r => [r.id, r.name, r.slug, r.category, r.city, r.website, r.supportEnabled, r.disabledAt?.toISOString(), r.createdAt.toISOString()]));
      name = "businesses";
    } else if (kind === "audit") {
      const rows = await db().auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10000 });
      csv = toCsv(["id", "actor", "action", "target", "detail", "created_at"], rows.map(r => [r.id, r.actorId, r.action, r.targetId, r.detail, r.createdAt.toISOString()]));
      name = "audit-log";
    } else throw new AppError("Unknown export.", 404);
    await db().auditLog.create({ data: { actorId: user.id, action: "admin-export", targetId: kind!, detail: `${name}.csv exported.` } });
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="reviewmatters-${name}.csv"` } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: error instanceof AppError ? error.message : "Export failed." }, { status });
  }
}
