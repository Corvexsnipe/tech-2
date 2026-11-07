import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "./db";
import path from "node:path";

export const MAX_UPLOAD = 5 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
export function uploadDirectory() {
  const directory = process.env.UPLOAD_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new AppError("Private attachment storage is not configured.", 503);
  const publicDirectory = path.resolve(process.cwd(), "public");
  const relative = path.relative(publicDirectory, path.resolve(directory));
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new AppError("Attachment storage must be outside public files.", 503);
  return directory;
}
export async function sanitizeImage(buffer: Buffer, maxBytes = MAX_UPLOAD) {
  if (!buffer.length || buffer.length > maxBytes) throw new AppError(`Choose an image no larger than ${Math.round(maxBytes / 1048576)} MB.`, 413);
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.includes(detected.mime)) throw new AppError("Only JPEG, PNG, and WebP images are allowed.", 415);
  try {
    const image = sharp(buffer, { limitInputPixels: 20_000_000, animated: false });
    const metadata = await image.metadata();
    if ((metadata.pages || 1) > 1) throw new Error("Animated images are not supported.");
    // Full decode and fresh encoding remove EXIF/GPS and any trailing payload.
    return await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  } catch {
    throw new AppError("This image is damaged, too large in dimensions, or unsupported.", 415);
  }
}

export function canReadEvidence(
  attachment: {
    userId: string; status: string;
    review: { status: string; business: { disabledAt: Date | null } } | null;
    ticketMessage?: { internal: boolean; ticket: { userId: string } } | null;
  },
  user: { id: string; role: string } | null,
) {
  if (user && ["MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) return true;
  if (user?.id === attachment.userId && attachment.status !== "REMOVED") return true;
  // Ticket attachments are private to the ticket owner and staff. Files on
  // internal notes are never exposed to the owner.
  if (attachment.ticketMessage) return !attachment.ticketMessage.internal && attachment.ticketMessage.ticket.userId === user?.id;
  return attachment.status === "PUBLISHED" && attachment.review?.status === "PUBLISHED" && !attachment.review.business.disabledAt;
}
