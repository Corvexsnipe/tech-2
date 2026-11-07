import QRCode from "qrcode";
import { canonicalProfile, profileSlug } from "./db";

// Immutable slug + format identifies the image. Authorization is always checked
// by the endpoint before consulting this bounded, process-local image cache.
const cache = new Map<string, Promise<string | Uint8Array>>();
export function businessQr(business: { slug: string; domain?: string | null }, format: "png" | "svg") {
  const slug = profileSlug(business);
  const key = `${slug}:${format}`;
  const existing = cache.get(key);
  if (existing) return existing;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const options = { errorCorrectionLevel: "H" as const, margin: 4, width: 1600, color: { dark: "#17132FFF", light: "#FFFFFFFF" } };
  const image = format === "svg"
    ? QRCode.toString(canonicalProfile(business), { ...options, type: "svg" })
    : QRCode.toBuffer(canonicalProfile(business), { ...options, type: "png" }).then(buffer => new Uint8Array(buffer));
  cache.set(key, image);
  image.catch(() => { cache.delete(key); });
  return image;
}
