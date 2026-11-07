import { configured, db } from "@/lib/db";
export async function GET() {
  if (!configured()) return Response.json({ status: "setup-required" }, { status: 503 });
  try {
    await db().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
