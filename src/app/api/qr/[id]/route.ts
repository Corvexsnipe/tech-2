import { AppError } from "@/lib/db";
import { owner } from "@/lib/security";
import { businessQr } from "@/lib/qr";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { business } = await owner((await context.params).id);
    const params = new URL(request.url).searchParams;
    const format = params.get("format") === "svg" ? "svg" : "png";
    const body = await businessQr(business, format);
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { headers: {
      "Content-Type": format === "svg" ? "image/svg+xml" : "image/png",
      "Content-Disposition": `${params.has("download") ? "attachment" : "inline"}; filename="review-matters-${business.slug}.${format}"`,
      "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : "QR code unavailable." }, { status: error instanceof AppError ? error.status : 500 });
  }
}
