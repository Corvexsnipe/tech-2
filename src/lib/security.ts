import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { compare, hash } from "bcryptjs";
import { AppError, appUrl, configured, db } from "./db";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-rm_session" : "rm_session";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const passwordHash = (password: string) => hash(password, 12);
export const passwordMatches = (password: string, hashed: string) => compare(password, hashed);

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("This request origin is not allowed.", 403);
  // The configured canonical origin always passes; otherwise the origin must
  // target the same host:port the request actually arrived on — covering dev
  // on 127.0.0.1/localhost/LAN addresses and TLS-terminating proxies (scheme
  // may legitimately differ) without accepting cross-site posts.
  if (origin === appUrl()) return;
  try {
    if (new URL(origin).host === new URL(request.url).host) return;
  } catch { /* malformed origin header */ }
  throw new AppError("This request origin is not allowed.", 403);
}

export function secret() {
  const value = process.env.APP_SECRET;
  if (!value || value.length < 32) throw new AppError("Secure account configuration is pending.", 503);
  return value;
}

export async function rateLimit(scope: string, identity: string, limit: number, seconds: number) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = createHmac("sha256", secret()).update(`${scope}:${identity}:${window}`).digest("hex");
  const bucket = await db().rateBucket.upsert({
    where: { key }, create: { key, count: 1, expiresAt: new Date((window + 1) * seconds * 1000) },
    update: { count: { increment: 1 } },
  });
  if (bucket.count > limit) throw new AppError("Too many attempts. Please wait before trying again.", 429);
}

export async function currentUser() {
  if (!configured()) return null;
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const session = await db().session.findUnique({ where: { id: digest(value) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || session.user.disabledAt) return null;
  return session.user;
}

export async function requireUser(verified = true) {
  const user = await currentUser();
  if (!user) throw new AppError("Please sign in to continue.", 401);
  if (verified && !user.verifiedAt) throw new AppError("Verify your email before continuing.", 403);
  return user;
}

const STAFF = ["MODERATOR", "ADMIN", "SUPER_ADMIN"];
export const staffMember = (user: { role: string } | null | undefined) => !!user && STAFF.includes(user.role);

export async function pageUser(staff = false) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (staff && !staffMember(user)) redirect("/account");
  return user;
}

export async function owner(businessId: string) {
  const user = await requireUser();
  const business = await db().business.findUnique({ where: { id: businessId }, include: { members: { where: { userId: user.id } } } });
  if (!business || (!staffMember(user) && !business.members.length)) throw new AppError("You cannot manage this business.", 403);
  if (business.disabledAt) throw new AppError("This business is unavailable. Contact platform support.", 409);
  return { user, business };
}

export async function createSession(userId: string) {
  const value = token();
  const expires = new Date(Date.now() + 7 * 86400_000);
  await db().session.create({ data: { id: digest(value), userId, expiresAt: expires } });
  (await cookies()).set(COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

export async function endSession() {
  const jar = await cookies();
  const value = jar.get(COOKIE)?.value;
  if (value && configured()) await db().session.deleteMany({ where: { id: digest(value) } });
  jar.delete(COOKIE);
}

export function safeTokenEquals(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
