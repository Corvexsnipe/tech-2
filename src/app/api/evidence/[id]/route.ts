import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppError, db } from "@/lib/db";
import { currentUser } from "@/lib/security";
import { canReadEvidence, uploadDirectory } from "@/lib/uploads";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const attachment = await db().attachment.findUnique({ where: { id }, include: {
      review: { include: { business: { select: { disabledAt: true } } } },
      ticketMessage: { select: { internal: true, ticket: { select: { userId: true } } } },
    } });
    const user = await currentUser();
    if (!attachment || !canReadEvidence(attachment, user)) throw new AppError("Attachment is not available.", 404);
    if (!/^[a-f0-9]{48}\.webp$/.test(attachment.storageKey)) throw new AppError("Attachment is not available.", 404);
    const bytes = await readFile(path.join(uploadDirectory(), attachment.storageKey));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Content-Disposition": 'inline; filename="supporting-image.webp"',
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : "Attachment unavailable." }, { status: error instanceof AppError ? error.status : 404 });
  }
}
