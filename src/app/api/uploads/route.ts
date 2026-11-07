import { NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { AppError, db } from "@/lib/db";
import { assertSameOrigin, rateLimit, requireUser } from "@/lib/security";
import { limitedBody } from "@/lib/validation";
import { MAX_UPLOAD, sanitizeImage, uploadDirectory } from "@/lib/uploads";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let storedPath: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit("uploads", user.id, 20, 3600);
    if (await db().attachment.count({ where: { userId: user.id, reviewId: null, ticketMessageId: null, status: "PENDING" } }) >= 12) throw new AppError("Remove unused attachments before uploading more.");
    const maxBytes = (await db().platformConfig.findUnique({ where: { id: "platform" }, select: { maxAttachmentBytes: true } }))?.maxAttachmentBytes ?? MAX_UPLOAD;
    const image = await sanitizeImage(await limitedBody(request, maxBytes), maxBytes);
    const directory = uploadDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const storageKey = `${randomBytes(24).toString("hex")}.webp`;
    storedPath = path.join(directory, storageKey);
    await writeFile(storedPath, image, { flag: "wx", mode: 0o600 });
    const attachment = await db().attachment.create({ data: { userId: user.id, storageKey, mime: "image/webp", size: image.length, label: "Supporting image" } });
    return NextResponse.json({ id: attachment.id, label: attachment.label }, { status: 201 });
  } catch (error) {
    if (storedPath) await unlink(storedPath).catch(() => {});
    return NextResponse.json({ error: error instanceof AppError ? error.message : "Upload failed. Please try again." }, { status: error instanceof AppError ? error.status : 500 });
  }
}
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id || id.length > 100) throw new AppError("Attachment ID is required.");
    const attachment = await db().attachment.findFirst({ where: { id, userId: user.id, reviewId: null, ticketMessageId: null } });
    if (!attachment) throw new AppError("Attachment not found.", 404);
    // Conditional delete prevents removing evidence that was concurrently submitted.
    const result = await db().attachment.deleteMany({ where: { id, userId: user.id, reviewId: null, ticketMessageId: null } });
    if (!result.count) throw new AppError("This attachment has already been submitted.", 409);
    await unlink(path.join(uploadDirectory(), attachment.storageKey)).catch(() => {});
    return NextResponse.json({ message: "Attachment removed." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AppError ? error.message : "Could not remove attachment." }, { status: error instanceof AppError ? error.status : 500 });
  }
}
