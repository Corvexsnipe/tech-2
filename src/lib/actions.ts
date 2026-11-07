import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { AppError, appUrl, configured, db } from "./db";
import { activeReviewKey, reviewScore, toDbGrade } from "./grades";
import { createSession, digest, endSession, owner, passwordHash, passwordMatches, rateLimit, requireUser, staffMember } from "./security";
import { hasRole, notifyStaff, requireRole, REPORT_KINDS } from "./admin";
import { mailConfigured, sendAccountEmail, sendMail, sendMailResilient, sendReviewConfirmation, SUPPORT_ALERT_EMAIL } from "./mail";
import { ipHashCurrent, ipHashes } from "./security/ip-resolver";
import { createAssessment, manualSecurityDecision, runSecurityCheck, runSecurityCheckWithBudget } from "./security/review-security";
import { securityConfig } from "./security/config";
import { assertFeedUrl, FEED_CATEGORIES, refreshFeed } from "./security/feeds";
import { runSecurityJobs } from "./security/jobs";
import { businessFields, domainInput, email, id, normalizeDomain, password, reviewInput, text, TICKET_CATEGORIES, website } from "./validation";
import { randomBytes } from "node:crypto";

type Tx = Prisma.TransactionClient;
const audit = (tx: Tx, actorId: string | null, action: string, targetId: string, detail: string) => tx.auditLog.create({ data: { actorId, action, targetId, detail } });
const notify = (tx: Tx, userId: string, message: string, href = "/account") => tx.notification.create({ data: { userId, message, href } });
// Remote database latency means a multi-query transaction can exceed the
// default 5s timeout; 20s keeps headroom while bounded by maxWait.
const serial = <T>(fn: (tx: Tx) => Promise<T>) => db().$transaction(fn, { isolationLevel: "Serializable", timeout: 20000, maxWait: 10000 });
const ok = (message: string, redirect?: string) => ({ message, redirect });
const credentials = z.object({ email, password: z.string().min(1).max(200) });
const dummyHash = "$2b$12$KIXx8SBy/69G0yMB0Yw6TOkFQ1rDHtJgc7i9JdB1gI8dMVvOVlxkO";

async function assertWritable() {
  const config = await db().platformConfig.findUnique({ where: { id: "platform" } });
  if (config?.readOnly) throw new AppError("The platform is in read-only mode while maintenance is underway. Please try again later.", 503);
}

export async function performAction(action: string, payload: unknown, clientIp?: string | null) {
  if (action === "contact") {
    const data = z.object({ email, name: text(2, 80), subject: text(5, 150), body: text(20, 3000) }).parse(payload);
    await rateLimit("contact", data.email, 3, 3600);
    await rateLimit("contact-total", "platform", 100, 3600);
    await db().contactMessage.create({ data });
    return ok("Your message has been saved for the platform team. No email confirmation has been sent.");
  }
  if (action === "register") {
    const data = z.object({ email, password, displayName: text(2, 60) }).parse(payload);
    await rateLimit("register", data.email, 4, 3600);
    await rateLimit("register-total", "platform", 1000, 3600);
    if (!mailConfigured()) throw new AppError("Registration will open when email delivery is configured.", 503);
    const existing = await db().user.findUnique({ where: { email: data.email } });
    let created = existing;
    if (!existing) {
      try {
        created = await db().user.create({ data: { email: data.email, displayName: data.displayName, passwordHash: await passwordHash(data.password) } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    // A repeat request for an unverified account resends verification without
    // disclosing whether the account exists.
    if (created && !created.verifiedAt && !created.disabledAt) await sendAccountEmail(created, "verify");
    return ok("If this address is eligible, a verification email has been sent. You can then sign in.", "/sign-in?registered=1");
  }
  if (action === "login") {
    const data = credentials.parse(payload);
    await rateLimit("login", data.email, 10, 900);
    await rateLimit("login-total", "platform", 1000, 60);
    const user = await db().user.findUnique({ where: { email: data.email } });
    const matches = await passwordMatches(data.password, user?.passwordHash || dummyHash);
    if (!user || !matches || user.disabledAt) {
      if (configured()) await db().auditLog.create({ data: { actorId: null, action: "login-failed", targetId: digest(data.email), detail: "Failed sign-in attempt." } }).catch(() => {});
      throw new AppError("Email or password is incorrect.", 401);
    }
    await createSession(user.id);
    await db().auditLog.create({ data: { actorId: user.id, action: "login", targetId: user.id, detail: "New session created." } });
    await notify(db(), user.id, "A new session signed in to your account. If this was not you, change your password.");
    return ok("Signed in.", "/account");
  }
  if (action === "logout") {
    await endSession();
    return ok("Signed out.", "/");
  }
  if (action === "forgot-password" || action === "resend-verification") {
    const data = z.object({ email }).parse(payload);
    await rateLimit("account-email", data.email, 3, 3600);
    await rateLimit("account-email-total", "platform", 1000, 3600);
    if (!mailConfigured()) throw new AppError("Account email delivery is not configured.", 503);
    const user = await db().user.findUnique({ where: { email: data.email } });
    if (user && !user.disabledAt && (action === "forgot-password" || !user.verifiedAt)) await sendAccountEmail(user, action === "forgot-password" ? "reset" : "verify");
    return ok("If an eligible account exists, an email has been sent. Check your inbox and spam folder.");
  }
  if (action === "verify-email" || action === "reset-password") {
    const data = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: password.optional() }).parse(payload);
    if (action === "reset-password" && !data.password) throw new AppError("A new password is required.");
    const candidate = await db().accountToken.findUnique({ where: { id: digest(data.token) } });
    if (!candidate || candidate.expiresAt < new Date() || candidate.kind !== (action === "verify-email" ? "verify" : "reset")) throw new AppError("This link is invalid or expired. Request a new email.");
    await rateLimit("token-use", candidate.userId, 10, 3600);
    const hashed = action === "reset-password" ? await passwordHash(data.password!) : null;
    await serial(async tx => {
      const stored = await tx.accountToken.findUnique({ where: { id: digest(data.token) }, include: { user: true } });
      if (!stored || stored.expiresAt < new Date() || stored.user.disabledAt || stored.kind !== (action === "verify-email" ? "verify" : "reset")) throw new AppError("This link is invalid or expired. Request a new email.");
      await tx.accountToken.deleteMany({ where: { userId: stored.userId, kind: stored.kind } });
      const reset = action === "reset-password";
      await tx.user.update({ where: { id: stored.userId }, data: reset ? { passwordHash: hashed! } : { verifiedAt: new Date() } });
      if (reset) await tx.session.deleteMany({ where: { userId: stored.userId } });
      await notify(tx, stored.userId, reset ? "Your password was reset. All sessions have been signed out." : "Your email address is now verified.");
      await audit(tx, stored.userId, action, stored.userId, "Account token consumed.");
    });
    return ok(action === "verify-email" ? "Email verified. You can now sign in." : "Password reset. Please sign in.", "/sign-in");
  }

  const user = await requireUser(action !== "account-update" && action !== "password-change" && action !== "notifications-read");
  await rateLimit("actions", user.id, 120, 60);

  if (action === "account-update") {
    const data = z.object({ displayName: text(2, 60) }).parse(payload);
    await serial(async tx => {
      await tx.user.update({ where: { id: user.id }, data });
      await audit(tx, user.id, action, user.id, "Display name updated.");
    });
    return ok("Your profile has been updated.");
  }
  if (action === "password-change") {
    const data = z.object({ currentPassword: z.string().max(200), password }).parse(payload);
    await rateLimit("password-change", user.id, 5, 900);
    if (!await passwordMatches(data.currentPassword, user.passwordHash)) throw new AppError("Current password is incorrect.");
    const hashed = await passwordHash(data.password);
    await serial(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashed } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await notify(tx, user.id, "Your password changed. All previous sessions were revoked.");
      await audit(tx, user.id, action, user.id, "Password changed; sessions revoked.");
    });
    await createSession(user.id);
    return ok("Password changed. All other sessions were signed out.");
  }
  if (action === "notifications-read") {
    await db().notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return ok("Notifications marked as read.");
  }
  if (action === "review-submit") {
    const data = reviewInput.parse(payload);
    await rateLimit("review-submit", user.id, 5, 3600);
    await assertWritable();
    const submission = await serial(async tx => {
      const business = await tx.business.findUnique({ where: { id: data.businessId }, include: { members: { where: { userId: user.id } } } });
      if (!business || business.disabledAt) throw new AppError("This business is unavailable.", 404);
      if (business.members.length) throw new AppError("You cannot review a business you manage.", 403);
      if (business.supportEnabled !== Boolean(data.supportGrade)) throw new AppError("The business categories changed. Refresh the page and select the required grades.", 409);
      const limit = (await tx.platformConfig.findUnique({ where: { id: "platform" } }))?.maxAttachments ?? 4;
      if (data.attachmentIds.length > limit) throw new AppError(`At most ${limit} attachments are allowed per review.`);
      const attachments = await tx.attachment.findMany({ where: { id: { in: data.attachmentIds }, userId: user.id, reviewId: null, ticketMessageId: null, status: "PENDING" } });
      if (attachments.length !== data.attachmentIds.length) throw new AppError("An attachment is unavailable or does not belong to you.");
      // One active review per client network per business. The check runs
      // inside the serializable transaction (matching every HMAC key version
      // so key rotation cannot reopen a slot) and is backed by a partial
      // unique index, so concurrent submissions cannot race past it.
      const hashed = clientIp ? ipHashCurrent(clientIp) : null;
      const duplicate = clientIp && await tx.review.findFirst({ where: { businessId: business.id, ipHash: { in: ipHashes(clientIp) }, status: { in: ["PENDING", "PUBLISHED", "HIDDEN", "INFO_REQUESTED"] } }, select: { id: true } });
      const security = securityConfig();
      // The review is persisted in a non-publishable state first. It becomes
      // PUBLISHED only after security clears it AND staff approve it.
      const review = await tx.review.create({ data: {
        userId: user.id, businessId: business.id, headline: data.headline, body: data.body,
        serviceGrade: toDbGrade(data.serviceGrade), supportGrade: data.supportGrade ? toDbGrade(data.supportGrade) : null,
        supportSnapshot: business.supportEnabled, score: reviewScore(data.serviceGrade, data.supportGrade),
        activeKey: activeReviewKey(user.id, business.id), ipHash: hashed?.hash ?? null, ipHashVersion: hashed?.version ?? 1,
        status: duplicate ? "REJECTED" : "PENDING",
        securityState: duplicate ? "SECURITY_CLEARED" : "PENDING_SECURITY_CHECK",
        moderationNote: duplicate ? "Automatically held: another active review from this network already exists for this business." : null,
      } });
      if (!duplicate && security.enabled) await createAssessment(tx, review.id, clientIp ?? null);
      await tx.attachment.updateMany({ where: { id: { in: data.attachmentIds }, userId: user.id, reviewId: null }, data: { reviewId: review.id } });
      if (duplicate) await notify(tx, user.id, "Your review could not be published: this network already has a review for this business. Contact support if this is an error.");
      await audit(tx, user.id, action, review.id, duplicate ? "Held by duplicate-network check." : security.enabled ? "Submitted; awaiting network security verification." : "Submitted (security verification disabled).");
      return { review, business, blocked: Boolean(duplicate), securityEnabled: security.enabled };
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError("You have already submitted a review for this business.", 409);
      throw error;
    });
    if (submission.blocked) throw new AppError("You have already submitted a review for this business.", 409);
    // The security check runs after commit (never inside the transaction)
    // with a time budget. Clearing sends the review to the staff approval
    // queue; nothing is ever published automatically.
    if (submission.securityEnabled) await runSecurityCheckWithBudget(submission.review.id, clientIp ?? null);
    else await runSecurityCheck(submission.review.id, { ip: clientIp ?? null });
    return ok("Your review has been submitted successfully! It will appear publicly once our team approves it.", "/account?submitted=pending");
  }
  if (action === "review-withdraw") {
    const data = z.object({ id }).parse(payload);
    await serial(async tx => {
      const review = await tx.review.findFirst({ where: { id: data.id, userId: user.id } });
      if (!review) throw new AppError("Review not found.", 404);
      await tx.review.update({ where: { id: review.id }, data: { status: "REMOVED", activeKey: null, moderationNote: "Withdrawn by the reviewer." } });
      await tx.attachment.updateMany({ where: { reviewId: review.id }, data: { status: "REMOVED" } });
      await audit(tx, user.id, action, review.id, "Withdrawn by reviewer.");
    });
    return ok("Review withdrawn. It is no longer public.");
  }
  if (action === "business-claim") {
    const data = z.object({
      businessId: id.optional(), evidence: text(30, 3000),
      name: text(2, 100).optional(), description: text(20, 2000).optional(),
      category: text(2, 60).optional(), city: text(2, 100).optional(),
      website, domain: domainInput.optional(), supportEnabled: z.boolean().optional(),
    }).parse(payload);
    if (!data.businessId && !(data.name && data.description && data.category && data.city)) throw new AppError("Complete business details are required to register a new listing.");
    // Ownership is verified through the official business website, so new
    // registrations must include one — and the domain that becomes the
    // public profile path (/review/<domain>).
    if (!data.businessId) {
      if (!data.website) throw new AppError("A business website is required. We verify ownership through the official site.", 422);
      if (!data.domain) throw new AppError("Your business domain is required, for example caspian.host. It becomes the public profile address.", 422);
      if (data.domain !== normalizeDomain(data.website)) throw new AppError("The domain must match your business website.", 422);
    }
    await rateLimit("claim", user.id, 3, 86400);
    await assertWritable();
    const claimedBusinessName = await serial(async tx => {
      let business;
      if (data.businessId) {
        business = await tx.business.findUnique({ where: { id: data.businessId }, include: { members: true } });
        if (!business || business.disabledAt || business.members.length) throw new AppError("This business is unavailable for a new claim. Contact support.");
      } else {
        if (await tx.business.findFirst({ where: { OR: [{ domain: data.domain! }, { slug: data.domain! }] } }))
          throw new AppError("A business profile already exists for this domain. Claim the existing listing instead.", 409);
        business = await tx.business.create({ data: {
          name: data.name!, description: data.description!, category: data.category!, city: data.city!, website: data.website || null, domain: data.domain!,
          supportEnabled: data.supportEnabled ?? true, slug: data.domain!, disabledAt: new Date(),
        } });
      }
      const claim = await tx.claim.create({ data: { userId: user.id, businessId: business.id, evidence: data.evidence } });
      await notify(tx, user.id, "Your business claim is pending administrator verification.", "/dashboard");
      await audit(tx, user.id, action, claim.id, "Pending ownership verification.");
      return business.name;
    });
    await notifyStaff("ADMIN", `New ownership claim for ${claimedBusinessName} awaits verification.`, "/review-matter-panel/claims");
    return ok("Claim submitted. An administrator must verify ownership before access is granted.", "/dashboard");
  }
  if (action === "business-update") {
    const data = z.object({ businessId: id, ...businessFields }).parse(payload);
    await owner(data.businessId);
    await serial(async tx => {
      const domain = data.website ? normalizeDomain(data.website) : null;
      if (domain && await tx.business.findFirst({ where: { OR: [{ domain }, { slug: domain }], NOT: { id: data.businessId } } }))
        throw new AppError("Another business profile already uses that domain.", 409);
      await tx.business.update({ where: { id: data.businessId }, data: {
        name: data.name, description: data.description, category: data.category, city: data.city,
        website: data.website || null, domain, supportEnabled: data.supportEnabled,
      } });
      await audit(tx, user.id, action, data.businessId, `Profile updated. Support enabled: ${data.supportEnabled}. Historical review scores preserved.`);
    });
    return ok("Business settings saved. Your profile address and historical scores are unchanged.");
  }
  if (action === "reply") {
    const data = z.object({ reviewId: id, body: text(10, 2000) }).parse(payload);
    await assertWritable();
    const review = await db().review.findUnique({ where: { id: data.reviewId } });
    if (!review || review.status !== "PUBLISHED") throw new AppError("Published review not found.", 404);
    await owner(review.businessId);
    await serial(async tx => {
      const reply = await tx.reply.upsert({ where: { reviewId: review.id }, create: { reviewId: review.id, userId: user.id, body: data.body }, update: { body: data.body, userId: user.id, status: "PENDING" } });
      await audit(tx, user.id, action, reply.id, "Reply submitted for moderation.");
    });
    return ok("Your response is awaiting moderation.");
  }
  if (action === "report") {
    const data = z.object({ targetType: z.enum(["review", "attachment", "reply"]), targetId: id, kind: z.enum(REPORT_KINDS).default("other"), reason: text(10, 2000) }).parse(payload);
    await rateLimit("report", user.id, 10, 3600);
    await assertWritable();
    const visible = data.targetType === "review"
      ? await db().review.findFirst({ where: { id: data.targetId, status: "PUBLISHED", business: { disabledAt: null } } })
      : data.targetType === "attachment"
        ? await db().attachment.findFirst({ where: { id: data.targetId, status: "PUBLISHED", review: { status: "PUBLISHED", business: { disabledAt: null } } } })
        : await db().reply.findFirst({ where: { id: data.targetId, status: "PUBLISHED", review: { status: "PUBLISHED", business: { disabledAt: null } } } });
    if (!visible) throw new AppError("Content is no longer available.", 404);
    await db().report.create({ data: { ...data, userId: user.id } });
    await notifyStaff("MODERATOR", `A ${data.targetType} was reported (${data.kind}).`, "/review-matter-panel/reports");
    return ok("Report received. An administrator will review it.");
  }
  if (action === "review-appeal") {
    const data = z.object({ id, reason: text(10, 2000) }).parse(payload);
    await rateLimit("appeal", user.id, 5, 86400);
    await serial(async tx => {
      const review = await tx.review.findFirst({ where: { id: data.id, userId: user.id } });
      if (!review) throw new AppError("Review not found.", 404);
      if (!["REJECTED", "REMOVED", "HIDDEN"].includes(review.status)) throw new AppError("Only unpublished reviews can be appealed.", 409);
      if (review.appealedAt) throw new AppError("This review is already awaiting a second look.", 409);
      await tx.review.update({ where: { id: review.id }, data: { appealedAt: new Date(), appealNote: data.reason } });
      await audit(tx, user.id, action, review.id, `Appeal filed: ${data.reason.slice(0, 200)}`);
    });
    await notifyStaff("MODERATOR", "A reviewer appealed a moderation decision.", "/review-matter-panel/reviews?status=appealed");
    return ok("Appeal submitted. A different moderator will re-examine the decision.");
  }
  if (action === "account-deletion-request") {
    const data = z.object({ reason: text(10, 2000) }).parse(payload);
    await serial(async tx => {
      if (user.deletionRequestedAt) throw new AppError("A deletion request is already pending.");
      await tx.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } });
      await audit(tx, user.id, action, user.id, `Deletion requested: ${data.reason.slice(0, 200)}`);
    });
    await notifyStaff("ADMIN", "An account requested deletion.", "/review-matter-panel/users?status=deletion");
    return ok("Deletion request recorded. An administrator will verify and process it.");
  }
  if (action === "ticket-create") {
    const data = z.object({
      subject: text(5, 150), category: z.enum(TICKET_CATEGORIES), body: text(10, 5000),
      businessId: id.optional(), attachmentIds: z.array(id).max(4).default([]),
    }).refine(v => new Set(v.attachmentIds).size === v.attachmentIds.length, "Duplicate attachment.").parse(payload);
    await rateLimit("ticket-create", user.id, 5, 3600);
    await assertWritable();
    const created = await serial(async tx => {
      let business = null;
      if (data.businessId) {
        business = await tx.business.findFirst({ where: { id: data.businessId, members: { some: { userId: user.id } } } });
        if (!business) throw new AppError("You can only link a ticket to a business you manage.", 403);
      }
      const attachments = await tx.attachment.findMany({ where: { id: { in: data.attachmentIds }, userId: user.id, reviewId: null, ticketMessageId: null, status: "PENDING" } });
      if (attachments.length !== data.attachmentIds.length) throw new AppError("An attachment is unavailable or does not belong to you.");
      const ticket = await tx.ticket.create({ data: { userId: user.id, businessId: business?.id || null, subject: data.subject, category: data.category } });
      const message = await tx.ticketMessage.create({ data: { ticketId: ticket.id, authorId: user.id, body: data.body } });
      if (attachments.length) await tx.attachment.updateMany({ where: { id: { in: attachments.map(a => a.id) } }, data: { ticketMessageId: message.id, status: "PUBLISHED" } });
      await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: "Ticket created." } });
      await notify(tx, user.id, `Your support ticket ${ticket.number} was created.`, `/dashboard/support/${ticket.id}`);
      await audit(tx, user.id, action, ticket.id, `Ticket ${ticket.number} (${data.category}).`);
      return { ticket, business };
    });
    // Emails are post-commit and deduplicated; delivery failure never loses the ticket.
    if (mailConfigured()) {
      const base = appUrl();
      const preview = data.body.length > 280 ? `${data.body.slice(0, 280)}…` : data.body;
      void sendMailResilient({ email: SUPPORT_ALERT_EMAIL }, "ticket-alert", {
        ticket: created.ticket.number, subject: data.subject, category: data.category,
        business: created.business?.name || "—", name: user.displayName, email: user.email,
        created: created.ticket.createdAt.toISOString(), preview, url: `${base}/review-matter-panel/support/${created.ticket.id}`,
      }, `ticket-alert:${created.ticket.id}`).catch(() => {});
      void sendMailResilient(user, "ticket-confirmation", {
        name: user.displayName, ticket: created.ticket.number, subject: data.subject,
        category: data.category, url: `${base}/dashboard/support/${created.ticket.id}`,
      }, `ticket-confirmation:${created.ticket.id}`).catch(() => {});
    }
    return ok("Your ticket was created. We will reply by email and in your dashboard.", `/dashboard/support/${created.ticket.id}`);
  }
  if (action === "ticket-reply") {
    const data = z.object({ id, body: text(5, 5000), attachmentIds: z.array(id).max(4).default([]) }).refine(v => new Set(v.attachmentIds).size === v.attachmentIds.length, "Duplicate attachment.").parse(payload);
    await rateLimit("ticket-reply", user.id, 20, 3600);
    await assertWritable();
    const result = await serial(async tx => {
      const ticket = await tx.ticket.findFirst({ where: { id: data.id, userId: user.id }, include: { assignee: { select: { email: true } }, business: { select: { name: true } } } });
      if (!ticket) throw new AppError("Ticket not found.", 404);
      if (ticket.status === "CLOSED") throw new AppError("This ticket is closed. Open a new ticket if you still need help.", 409);
      const attachments = await tx.attachment.findMany({ where: { id: { in: data.attachmentIds }, userId: user.id, reviewId: null, ticketMessageId: null, status: "PENDING" } });
      if (attachments.length !== data.attachmentIds.length) throw new AppError("An attachment is unavailable or does not belong to you.");
      const message = await tx.ticketMessage.create({ data: { ticketId: ticket.id, authorId: user.id, body: data.body } });
      if (attachments.length) await tx.attachment.updateMany({ where: { id: { in: attachments.map(a => a.id) } }, data: { ticketMessageId: message.id, status: "PUBLISHED" } });
      // An owner reply re-opens a ticket that was waiting on them.
      if (ticket.status === "WAITING_OWNER" || ticket.status === "RESOLVED") {
        await tx.ticket.update({ where: { id: ticket.id }, data: { status: "OPEN", resolvedAt: null } });
        await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: `Status changed to Open after owner reply.` } });
      }
      await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: "Owner replied." } });
      if (ticket.assigneeId) await notify(tx, ticket.assigneeId, `New reply on ticket ${ticket.number}.`, `/review-matter-panel/support/${ticket.id}`);
      return { ticket, message };
    });
    if (mailConfigured()) {
      const preview = data.body.length > 280 ? `${data.body.slice(0, 280)}…` : data.body;
      void sendMailResilient({ email: result.ticket.assignee?.email || SUPPORT_ALERT_EMAIL }, "ticket-reply-staff", {
        ticket: result.ticket.number, subject: result.ticket.subject, business: result.ticket.business?.name || "—",
        name: user.displayName, email: user.email, preview, url: `${appUrl()}/review-matter-panel/support/${result.ticket.id}`,
      }, `ticket-reply-staff:${result.message.id}`).catch(() => {});
    }
    return ok("Your reply was added.");
  }
  if (!staffMember(user)) throw new AppError("Administrator access is required.", 403);
  const need = (minimum: Role) => requireRole(user, minimum);
  if (action === "admin-note") {
    need("MODERATOR");
    const data = z.object({ targetType: z.enum(["user", "business", "review", "claim", "report"]), targetId: id, body: text(3, 2000) }).parse(payload);
    await serial(async tx => {
      await tx.adminNote.create({ data: { authorId: user.id, ...data } });
      await audit(tx, user.id, action, data.targetId, `Private note added to ${data.targetType}.`);
    });
    return ok("Note recorded.");
  }
  if (action === "admin-contact") {
    need("ADMIN");
    const data = z.object({ id }).parse(payload);
    await serial(async tx => {
      await tx.contactMessage.update({ where: { id: data.id }, data: { resolvedAt: new Date() } });
      await audit(tx, user.id, action, data.id, "Contact message marked resolved.");
    });
    return ok("Contact message marked resolved.");
  }
  if (action === "admin-config") {
    need("SUPER_ADMIN");
    const data = z.object({ minimumReviews: z.number().int().min(3).max(100) }).parse(payload);
    await serial(async tx => {
      await tx.platformConfig.upsert({ where: { id: "platform" }, create: { id: "platform", ...data }, update: data });
      await audit(tx, user.id, action, "platform", `Minimum published reviews: ${data.minimumReviews}`);
    });
    return ok("Platform policy updated.");
  }
  if (action === "admin-user") {
    need("ADMIN");
    const data = z.object({ id, disabled: z.boolean(), reason: text(10, 1000) }).parse(payload);
    if (data.id === user.id) throw new AppError("You cannot suspend your own account.");
    await serial(async tx => {
      const target = await tx.user.findUnique({ where: { id: data.id } });
      if (!target || target.role === "SUPER_ADMIN" || (hasRole(target, "MODERATOR") && !hasRole(user, "SUPER_ADMIN"))) throw new AppError("Staff accounts can only be suspended by a super admin.", 403);
      await tx.user.update({ where: { id: data.id }, data: { disabledAt: data.disabled ? new Date() : null } });
      if (data.disabled) await tx.session.deleteMany({ where: { userId: data.id } });
      await audit(tx, user.id, action, data.id, `${data.disabled ? "Suspended" : "Restored"}: ${data.reason}`);
    });
    return ok("Account status updated.");
  }
  if (action === "admin-business") {
    need("ADMIN");
    const data = z.object({ id, disabled: z.boolean(), reason: text(10, 1000) }).parse(payload);
    await serial(async tx => {
      await tx.business.update({ where: { id: data.id }, data: { disabledAt: data.disabled ? new Date() : null } });
      await audit(tx, user.id, action, data.id, `${data.disabled ? "Disabled" : "Restored"}: ${data.reason}`);
    });
    return ok("Business availability updated.");
  }
  if (action === "admin-claim") {
    need("ADMIN");
    const data = z.object({ id, approve: z.boolean().default(false), requestInfo: z.boolean().default(false), reason: text(10, 1000) }).parse(payload);
    const approved = await serial(async tx => {
      const claim = await tx.claim.findUnique({ where: { id: data.id }, include: { business: { include: { members: true } }, user: true } });
      if (!claim || !["PENDING", "INFO_REQUESTED"].includes(claim.status)) throw new AppError("This claim was already decided or does not exist.", 409);
      if (claim.userId === user.id) throw new AppError("You cannot decide your own claim.", 403);
      if (data.approve && (claim.business.members.length || !claim.user.verifiedAt || claim.user.disabledAt)) throw new AppError("Ownership exists or the claimant is not eligible.", 409);
      const status = data.approve ? "PUBLISHED" : data.requestInfo ? "INFO_REQUESTED" : "REJECTED";
      await tx.claim.update({ where: { id: claim.id }, data: { status, decision: data.reason } });
      if (data.approve) {
        await tx.membership.create({ data: { userId: claim.userId, businessId: claim.businessId } });
        await tx.business.update({ where: { id: claim.businessId }, data: { disabledAt: null } });
      }
      const verdict = data.approve ? "approved" : data.requestInfo ? "needs more information" : "rejected";
      await notify(tx, claim.userId, `Your claim for ${claim.business.name} was ${verdict}. ${data.reason}`, "/dashboard");
      await audit(tx, user.id, action, claim.id, `${verdict}: ${data.reason}`);
      return data.approve ? { user: { id: claim.user.id, email: claim.user.email, displayName: claim.user.displayName }, business: claim.business.name, claimId: claim.id } : null;
    });
    // Delivery is post-commit and deduplicated by claim id, so a retried
    // approval email never doubles.
    if (approved && mailConfigured())
      void sendMailResilient(approved.user, "claim-approval", { name: approved.user.displayName || approved.user.email, business: approved.business, url: `${appUrl()}/dashboard` }, `claim-approval:${approved.claimId}`).catch(() => {});
    return ok("Claim decision recorded.");
  }
  if (action === "admin-claim-assign" || action === "admin-review-assign" || action === "admin-report-assign") {
    need(action === "admin-claim-assign" ? "ADMIN" : "MODERATOR");
    const data = z.object({ id, assigneeId: z.union([z.literal(""), id]) }).parse(payload);
    const assigneeId = data.assigneeId || null;
    await serial(async tx => {
      if (assigneeId) {
        const target = await tx.user.findUnique({ where: { id: assigneeId } });
        if (!target || !staffMember(target) || target.disabledAt) throw new AppError("Assignments require an active staff account.", 400);
      }
      const table = action === "admin-claim-assign" ? tx.claim : action === "admin-review-assign" ? tx.review : tx.report;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (table as any).update({ where: { id: data.id }, data: { assigneeId } });
      if (assigneeId) await notify(tx, assigneeId, "A case was assigned to you.", action === "admin-claim-assign" ? "/review-matter-panel/claims" : action === "admin-review-assign" ? "/review-matter-panel/reviews" : "/review-matter-panel/reports");
      await audit(tx, user.id, action, data.id, assigneeId ? "Assigned to staff member." : "Assignment cleared.");
    });
    return ok("Assignment updated.");
  }
  if (action === "admin-domain-proof") {
    need("ADMIN");
    const data = z.object({ claimId: id.optional(), businessId: id.optional() }).refine(v => v.claimId || v.businessId, "A claim or business is required.").parse(payload);
    const mailed = await serial(async tx => {
      const code = randomBytes(12).toString("hex");
      const sentAt = new Date();
      if (data.claimId) {
        const claim = await tx.claim.findUnique({ where: { id: data.claimId }, include: { business: true, user: true } });
        if (!claim || !["PENDING", "INFO_REQUESTED"].includes(claim.status)) throw new AppError("This claim was already decided or does not exist.", 409);
        await tx.claim.update({ where: { id: claim.id }, data: { status: "INFO_REQUESTED", domainProofToken: code, domainProofSentAt: sentAt, decision: "Domain proof requested. Awaiting verification." } });
        await audit(tx, user.id, action, claim.id, `Domain proof requested from claimant; code ${code}.`);
        return [{ email: claim.user.email, displayName: claim.user.displayName, business: claim.business.name, website: claim.business.website || "the business website", code }];
      }
      const business = await tx.business.findUnique({ where: { id: data.businessId! }, include: { members: { include: { user: true } } } });
      if (!business) throw new AppError("Business not found.", 404);
      if (!business.members.length) throw new AppError("This business has no owners to verify.", 409);
      await audit(tx, user.id, action, business.id, `Domain proof requested from ${business.members.length} owner(s); code ${code}.`);
      return business.members.map(m => ({ email: m.user.email, displayName: m.user.displayName, business: business.name, website: business.website || "the business website", code }));
    });
    if (!mailConfigured()) throw new AppError("Email delivery is not configured. The proof request was recorded but no email was sent.", 503);
    for (const target of mailed) {
      // Failure is reported, not swallowed: the audit entry already exists, and
      // EmailLog records the delivery outcome for the operator.
      await sendMail({ email: target.email }, "domain-proof", {
        name: target.displayName, business: target.business, website: target.website, code: target.code,
      }, `domain-proof:${data.claimId || data.businessId}:${target.email}`).catch(() => {});
    }
    return ok("Domain proof request emailed. The code is recorded in the audit log.");
  }
  if (action === "admin-ticket-reply") {
    need("MODERATOR");
    const data = z.object({ id, body: text(5, 5000), internal: z.boolean().default(false), attachmentIds: z.array(id).max(4).default([]) }).parse(payload);
    await assertWritable();
    const result = await serial(async tx => {
      const ticket = await tx.ticket.findUnique({ where: { id: data.id }, include: { user: { select: { id: true, email: true, displayName: true } } } });
      if (!ticket) throw new AppError("Ticket not found.", 404);
      const attachments = await tx.attachment.findMany({ where: { id: { in: data.attachmentIds }, userId: user.id, reviewId: null, ticketMessageId: null, status: "PENDING" } });
      if (attachments.length !== data.attachmentIds.length) throw new AppError("An attachment is unavailable or does not belong to you.");
      const message = await tx.ticketMessage.create({ data: { ticketId: ticket.id, authorId: user.id, body: data.body, internal: data.internal } });
      if (attachments.length) await tx.attachment.updateMany({ where: { id: { in: attachments.map(a => a.id) } }, data: { ticketMessageId: message.id, status: "PUBLISHED" } });
      if (!data.internal && ticket.status === "OPEN") await tx.ticket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS" } });
      await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: data.internal ? "Internal note added." : "Staff reply sent." } });
      if (!data.internal) await notify(tx, ticket.userId, `Support replied to ticket ${ticket.number}.`, `/dashboard/support/${ticket.id}`);
      await audit(tx, user.id, data.internal ? "admin-ticket-note" : action, ticket.id, data.internal ? "Internal note added." : `Replied on ticket ${ticket.number}.`);
      return { ticket, message };
    });
    // Internal notes are never emailed to the owner.
    if (!data.internal && mailConfigured()) {
      const preview = data.body.length > 280 ? `${data.body.slice(0, 280)}…` : data.body;
      void sendMailResilient(result.ticket.user, "ticket-reply-owner", {
        name: result.ticket.user.displayName, ticket: result.ticket.number, subject: result.ticket.subject,
        preview, url: `${appUrl()}/dashboard/support/${result.ticket.id}`,
      }, `ticket-reply-owner:${result.message.id}`).catch(() => {});
    }
    return ok(data.internal ? "Internal note added." : "Reply posted. The owner is notified by email when delivery succeeds.");
  }
  if (action === "admin-ticket-status") {
    need("MODERATOR");
    const data = z.object({ id, status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_OWNER", "RESOLVED", "CLOSED"]), detail: text(0, 500).optional() }).parse(payload);
    const result = await serial(async tx => {
      const ticket = await tx.ticket.findUnique({ where: { id: data.id }, include: { user: { select: { id: true, email: true, displayName: true } } } });
      if (!ticket) throw new AppError("Ticket not found.", 404);
      if (ticket.status === data.status) throw new AppError(`The ticket is already ${data.status.toLowerCase().replace("_", " ")}.`, 409);
      const resolved = data.status === "RESOLVED" || data.status === "CLOSED";
      await tx.ticket.update({ where: { id: ticket.id }, data: { status: data.status, resolvedAt: resolved ? new Date() : null } });
      const event = await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: `Status changed to ${data.status.replace("_", " ")}.${data.detail ? ` ${data.detail}` : ""}` } });
      await notify(tx, ticket.userId, `Ticket ${ticket.number} is now ${data.status.toLowerCase().replace("_", " ")}.`, `/dashboard/support/${ticket.id}`);
      await audit(tx, user.id, action, ticket.id, `${ticket.status} → ${data.status}.`);
      return { ticket, event };
    });
    if (mailConfigured()) {
      void sendMailResilient(result.ticket.user, "ticket-status", {
        name: result.ticket.user.displayName, ticket: result.ticket.number, subject: result.ticket.subject,
        status: data.status.toLowerCase().replace("_", " "), detail: data.detail || "",
        url: `${appUrl()}/dashboard/support/${result.ticket.id}`,
      }, `ticket-status:${result.event.id}`).catch(() => {});
    }
    return ok("Ticket status updated.");
  }
  if (action === "admin-ticket-priority") {
    need("MODERATOR");
    const data = z.object({ id, priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]) }).parse(payload);
    await serial(async tx => {
      const ticket = await tx.ticket.findUnique({ where: { id: data.id } });
      if (!ticket) throw new AppError("Ticket not found.", 404);
      await tx.ticket.update({ where: { id: ticket.id }, data: { priority: data.priority } });
      await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: `Priority set to ${data.priority.toLowerCase()}.` } });
      await audit(tx, user.id, action, ticket.id, `Priority: ${ticket.priority} → ${data.priority}.`);
    });
    return ok("Ticket priority updated.");
  }
  if (action === "admin-ticket-assign") {
    need("ADMIN");
    const data = z.object({ id, assigneeId: z.union([z.literal(""), id]) }).parse(payload);
    const assigneeId = data.assigneeId || null;
    await serial(async tx => {
      if (assigneeId) {
        const target = await tx.user.findUnique({ where: { id: assigneeId } });
        if (!target || !staffMember(target) || target.disabledAt) throw new AppError("Assignments require an active staff account.", 400);
      }
      const ticket = await tx.ticket.update({ where: { id: data.id }, data: { assigneeId } });
      await tx.ticketEvent.create({ data: { ticketId: ticket.id, actorId: user.id, detail: assigneeId ? "Assigned to staff member." : "Assignment cleared." } });
      if (assigneeId) await notify(tx, assigneeId, `Ticket ${ticket.number} was assigned to you.`, `/review-matter-panel/support/${ticket.id}`);
      await audit(tx, user.id, action, ticket.id, assigneeId ? "Assigned to staff member." : "Assignment cleared.");
    });
    return ok("Ticket assignment updated.");
  }
  if (action === "admin-moderate") {
    need("MODERATOR");
    const data = z.object({ id, type: z.enum(["review", "attachment", "reply", "report"]), status: z.enum(["PUBLISHED", "REJECTED", "HIDDEN", "REMOVED"]), reason: z.string().trim().max(1000).default("") })
      .refine(v => v.status === "PUBLISHED" || v.reason.length >= 10, { message: "A reason of at least 10 characters is required." }).parse(payload);
    const published = await serial(async tx => {
      let publish: { userId: string; businessId: string } | null = null;
      if (data.type === "review") {
        const review = await tx.review.findUniqueOrThrow({ where: { id: data.id } });
        if (review.userId === user.id) throw new AppError("You cannot moderate your own review.", 403);
        // Publication requires a cleared security state; the Security Center
        // owns that decision so the audit trail stays in one place.
        if (data.status === "PUBLISHED" && review.securityState !== "SECURITY_CLEARED")
          throw new AppError("This review has not passed network security verification. Clear or reject it in Security Center first.", 409);
        await tx.review.update({ where: { id: data.id }, data: { status: data.status, moderationNote: data.reason || null, appealedAt: null, activeKey: data.status === "REMOVED" ? null : activeReviewKey(review.userId, review.businessId) } }).catch(error => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
            throw new AppError("Publishing conflicts with another active review from the same reviewer or network. Resolve that review first.", 409);
          throw error;
        });
        await notify(tx, review.userId, `Your review is now ${data.status.toLowerCase()}.${data.reason ? ` ${data.reason}` : ""}`);
        if (data.status === "PUBLISHED") publish = review;
      } else if (data.type === "attachment") {
        const attachment = await tx.attachment.findUniqueOrThrow({ where: { id: data.id } });
        if (!attachment.reviewId || attachment.userId === user.id) throw new AppError("This attachment cannot be moderated by you.", 403);
        await tx.attachment.update({ where: { id: data.id }, data: { status: data.status } });
        await notify(tx, attachment.userId, `Your proof attachment is now ${data.status.toLowerCase()}.${data.reason ? ` ${data.reason}` : ""}`);
      } else if (data.type === "reply") {
        const reply = await tx.reply.findUniqueOrThrow({ where: { id: data.id }, include: { review: true } });
        if (reply.userId === user.id) throw new AppError("You cannot moderate your own reply.", 403);
        await tx.reply.update({ where: { id: data.id }, data: { status: data.status } });
        await notify(tx, reply.userId, `Your business response is now ${data.status.toLowerCase()}.`, "/dashboard");
        if (data.status === "PUBLISHED") await notify(tx, reply.review.userId, "A business replied to your review.", "/account");
      } else {
        await tx.report.update({ where: { id: data.id }, data: { status: data.status, resolution: data.reason || null } });
      }
      await audit(tx, user.id, `moderate-${data.type}`, data.id, `${data.status}${data.reason ? `: ${data.reason}` : ""}`);
      return publish;
    });
    if (published && mailConfigured()) {
      const reviewer = await db().user.findUnique({ where: { id: published.userId }, select: { id: true, email: true, displayName: true } });
      const business = await db().business.findUnique({ where: { id: published.businessId }, select: { name: true } });
      if (reviewer && business) void sendReviewConfirmation(reviewer, data.id, business.name).catch(() => {});
    }
    return ok("Moderation decision saved.");
  }
  if (action === "admin-security-decision") {
    need("ADMIN");
    const data = z.object({ id, decision: z.enum(["clear", "reject", "hold"]), reason: text(10, 1000) }).parse(payload);
    await manualSecurityDecision(data.id, user.id, data.decision, data.reason);
    return ok(data.decision === "clear" ? "Review cleared and published." : data.decision === "reject" ? "Review rejected. The assessment and audit trail are preserved." : "Review held for manual security review.");
  }
  if (action === "admin-security-recheck") {
    need("MODERATOR");
    const data = z.object({ id }).parse(payload);
    const outcome = await runSecurityCheck(data.id, { force: true, actorId: user.id });
    await db().auditLog.create({ data: { actorId: user.id, action: "security-recheck", targetId: data.id, detail: `Re-check → ${outcome.state}${outcome.decision ? ` (${outcome.decision.classification}, score ${outcome.score})` : ""}` } });
    return ok(`Re-check complete: ${outcome.state.replace(/_/g, " ").toLowerCase()}.`);
  }
  if (action === "admin-security-feed") {
    need("ADMIN");
    const data = z.object({ id, op: z.enum(["refresh", "enable", "disable"]) }).parse(payload);
    const feed = await db().ipIntelligenceFeed.findUnique({ where: { id: data.id } });
    if (!feed) throw new AppError("Feed not found.", 404);
    if (data.op === "refresh") {
      await rateLimit("feed-refresh", user.id, 10, 3600);
      const result = await refreshFeed(feed);
      await db().auditLog.create({ data: { actorId: user.id, action: "security-feed-refresh", targetId: feed.id, detail: result.ok ? `${feed.source}: ${result.imported} records imported, ${result.rejected} rejected.` : `${feed.source}: failed (${result.error}).` } });
      if (!result.ok) throw new AppError(`Feed refresh failed (${result.error}). The previous dataset was kept.`, 502);
      return ok(`${feed.source}: ${result.imported} records imported (${result.rejected} malformed entries rejected).`);
    }
    await db().ipIntelligenceFeed.update({ where: { id: feed.id }, data: { enabled: data.op === "enable" } });
    await db().auditLog.create({ data: { actorId: user.id, action: "security-feed-toggle", targetId: feed.id, detail: `${feed.source} ${data.op}d.` } });
    return ok(`Feed ${data.op}d.`);
  }
  if (action === "admin-security-feed-add") {
    need("SUPER_ADMIN");
    const data = z.object({ source: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,60}$/, "Use lowercase letters, digits and dashes."), url: z.string().trim().max(500), category: z.enum(FEED_CATEGORIES as [string, ...string[]]), confidence: z.number().int().min(1).max(100), license: text(5, 300) }).parse(payload);
    try { assertFeedUrl(data.url); } catch (error) { throw new AppError(error instanceof Error ? error.message : "Invalid feed URL.", 422); }
    const feed = await db().ipIntelligenceFeed.create({ data: { source: data.source, url: data.url, category: data.category as (typeof FEED_CATEGORIES)[number], confidence: data.confidence, license: data.license } }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("A feed with that source name already exists.", 409);
      throw error;
    });
    await db().auditLog.create({ data: { actorId: user.id, action: "security-feed-add", targetId: feed.id, detail: `${data.source} (${data.category}, confidence ${data.confidence}) added. License: ${data.license}` } });
    return ok("Feed added. It will be imported on the next job run, or refresh it now.");
  }
  if (action === "admin-security-run") {
    need("ADMIN");
    await rateLimit("security-run", user.id, 6, 3600);
    const summary = await runSecurityJobs({ forceFeeds: z.object({ feeds: z.boolean().default(false) }).parse(payload ?? {}).feeds });
    await db().auditLog.create({ data: { actorId: user.id, action: "security-jobs-run", targetId: "security", detail: summary.skipped ? `Skipped: ${summary.skipped}` : `Feeds ${summary.feeds.length}, retried ${summary.retried}, re-evaluated ${summary.reevaluated} (${summary.flaggedOnReevaluation} flagged), purged ${summary.ipsPurged} IPs.` } });
    return ok(summary.skipped ? `Jobs skipped — ${summary.skipped}.` : `Jobs complete: ${summary.feeds.length} feed(s) processed, ${summary.retried} re-checked, ${summary.reevaluated} re-evaluated.`);
  }
  if (action === "admin-report") {
    need("MODERATOR");
    const data = z.object({ id, outcome: z.enum(["PUBLISHED", "REJECTED"]), reason: text(10, 1000), priority: z.number().int().min(0).max(3).default(0) }).parse(payload);
    await serial(async tx => {
      const report = await tx.report.findUnique({ where: { id: data.id } });
      if (!report || report.status !== "PENDING") throw new AppError("This report was already resolved.", 409);
      await tx.report.update({ where: { id: data.id }, data: { status: data.outcome, resolution: data.reason, priority: data.priority } });
      await notify(tx, report.userId, `Your report was ${data.outcome === "PUBLISHED" ? "resolved" : "dismissed"}. ${data.reason}`);
      await audit(tx, user.id, action, data.id, `${data.outcome === "PUBLISHED" ? "Resolved" : "Dismissed"} (priority ${data.priority}): ${data.reason}`);
    });
    return ok("Report resolution recorded.");
  }
  if (action === "admin-users-bulk") {
    need("ADMIN");
    const data = z.object({ op: z.enum(["suspend", "restore"]), ids: z.array(id).min(1).max(100), reason: text(10, 1000) }).parse(payload);
    await serial(async tx => {
      for (const targetId of data.ids) {
        const target = await tx.user.findUnique({ where: { id: targetId } });
        if (!target || target.id === user.id || target.role === "SUPER_ADMIN" || (hasRole(target, "MODERATOR") && !hasRole(user, "SUPER_ADMIN"))) continue;
        await tx.user.update({ where: { id: targetId }, data: { disabledAt: data.op === "suspend" ? new Date() : null } });
        if (data.op === "suspend") await tx.session.deleteMany({ where: { userId: targetId } });
        await audit(tx, user.id, action, targetId, `Bulk ${data.op}: ${data.reason}`);
      }
    });
    return ok("Bulk action completed. Ineligible accounts were skipped.");
  }
  if (action === "admin-user-sessions") {
    need("ADMIN");
    const data = z.object({ id }).parse(payload);
    if (data.id === user.id) throw new AppError("Use sign out to end your own session.");
    await serial(async tx => {
      await tx.session.deleteMany({ where: { userId: data.id } });
      await audit(tx, user.id, action, data.id, "All sessions revoked.");
    });
    return ok("Every session for that account was revoked.");
  }
  if (action === "admin-user-delete") {
    need("ADMIN");
    const data = z.object({ id, mode: z.enum(["complete", "dismiss"]) }).parse(payload);
    if (data.id === user.id) throw new AppError("You cannot process your own deletion request.");
    await serial(async tx => {
      const target = await tx.user.findUnique({ where: { id: data.id } });
      if (!target?.deletionRequestedAt) throw new AppError("No pending deletion request.", 409);
      if (data.mode === "dismiss") {
        await tx.user.update({ where: { id: data.id }, data: { deletionRequestedAt: null } });
        await notify(tx, data.id, "Your account deletion request was declined. Contact support if you believe this is an error.");
      } else {
        await tx.user.update({ where: { id: data.id }, data: {
          email: `deleted-${data.id}@removed.invalid`, displayName: "Deleted user", deletionRequestedAt: null, disabledAt: new Date(), verifiedAt: null,
        } });
        await tx.session.deleteMany({ where: { userId: data.id } });
        await tx.accountToken.deleteMany({ where: { userId: data.id } });
        await tx.membership.deleteMany({ where: { userId: data.id } });
      }
      await audit(tx, user.id, action, data.id, data.mode === "complete" ? "Account anonymized: email and name erased, sessions revoked." : "Deletion request dismissed.");
    });
    return ok("Deletion request processed.");
  }
  if (action === "admin-role") {
    need("SUPER_ADMIN");
    const data = z.object({ id, role: z.enum(["CUSTOMER", "MODERATOR", "ADMIN", "SUPER_ADMIN"]), reason: text(10, 1000) }).parse(payload);
    if (data.id === user.id) throw new AppError("You cannot change your own role.");
    await serial(async tx => {
      const target = await tx.user.findUnique({ where: { id: data.id } });
      if (!target) throw new AppError("Account not found.", 404);
      if (target.role === "SUPER_ADMIN" && data.role !== "SUPER_ADMIN" && (await tx.user.count({ where: { role: "SUPER_ADMIN", disabledAt: null } })) <= 1)
        throw new AppError("The last super admin cannot be demoted.", 409);
      await tx.user.update({ where: { id: data.id }, data: { role: data.role } });
      await tx.session.deleteMany({ where: { userId: data.id } });
      await notify(tx, data.id, `Your platform role changed to ${data.role.replace("_", " ").toLowerCase()}.`);
      await audit(tx, user.id, action, data.id, `Role ${target.role} → ${data.role}: ${data.reason}`);
    });
    return ok("Role updated. The account was signed out to apply the change.");
  }
  if (action === "admin-business-create") {
    need("ADMIN");
    const data = z.object(businessFields).parse(payload);
    const slugBase = data.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "business";
    const business = await serial(async tx => {
      const domain = data.website ? normalizeDomain(data.website) : null;
      if (domain && await tx.business.findFirst({ where: { OR: [{ domain }, { slug: domain }] } }))
        throw new AppError("Another business profile already uses that domain.", 409);
      const created = await tx.business.create({ data: { ...data, website: data.website || null, domain, slug: `${slugBase}-${randomBytes(6).toString("hex")}` } });
      await audit(tx, user.id, action, created.id, `Listing created by staff.`);
      return created;
    });
    return ok("Business listing created.", `/review-matter-panel/businesses/${business.id}`);
  }
  if (action === "admin-business-edit") {
    need("ADMIN");
    const data = z.object({ id, ...businessFields }).parse(payload);
    await serial(async tx => {
      const domain = data.website ? normalizeDomain(data.website) : null;
      if (domain && await tx.business.findFirst({ where: { OR: [{ domain }, { slug: domain }], NOT: { id: data.id } } }))
        throw new AppError("Another business profile already uses that domain.", 409);
      await tx.business.update({ where: { id: data.id }, data: { name: data.name, description: data.description, category: data.category, city: data.city, website: data.website || null, domain, supportEnabled: data.supportEnabled } });
      await audit(tx, user.id, action, data.id, `Listing edited by staff. Support enabled: ${data.supportEnabled}.`);
    });
    return ok("Listing updated. The permanent profile URL is unchanged.");
  }
  if (action === "admin-member") {
    need("ADMIN");
    const data = z.object({ businessId: id, userId: id.optional(), email: email.optional(), remove: z.boolean().default(false) }).parse(payload);
    await serial(async tx => {
      const targetId = data.userId || (await tx.user.findUnique({ where: { email: data.email || "" } }))?.id;
      if (!targetId) throw new AppError("No account uses that email.", 404);
      const target = await tx.user.findUniqueOrThrow({ where: { id: targetId } });
      if (data.remove) {
        await tx.membership.deleteMany({ where: { businessId: data.businessId, userId: targetId } });
        await notify(tx, targetId, "Your business management access was removed by platform staff.", "/dashboard");
      } else {
        if (!target.verifiedAt || target.disabledAt) throw new AppError("Owners need a verified, active account.", 409);
        await tx.membership.upsert({ where: { userId_businessId: { userId: targetId, businessId: data.businessId } }, create: { userId: targetId, businessId: data.businessId }, update: {} });
        await tx.business.update({ where: { id: data.businessId }, data: { disabledAt: null } });
        await notify(tx, targetId, "You were granted access to manage a business profile.", "/dashboard");
      }
      await audit(tx, user.id, action, data.businessId, `${data.remove ? "Owner removed" : "Owner assigned"}: ${target.email}`);
    });
    return ok("Ownership updated.");
  }
  if (action === "admin-category") {
    need("ADMIN");
    const data = z.object({ op: z.enum(["add", "rename", "remove"]), id: id.optional(), name: text(2, 60).optional() }).parse(payload);
    await serial(async tx => {
      if (data.op === "add") {
        await tx.category.create({ data: { name: data.name! } });
      } else if (data.op === "rename") {
        const category = await tx.category.findUniqueOrThrow({ where: { id: data.id! } });
        await tx.category.update({ where: { id: category.id }, data: { name: data.name! } });
        const moved = await tx.business.updateMany({ where: { category: category.name }, data: { category: data.name! } });
        await audit(tx, user.id, action, category.id, `Renamed ${category.name} → ${data.name}; ${moved.count} listings updated.`);
        return;
      } else {
        await tx.category.delete({ where: { id: data.id! } });
      }
      await audit(tx, user.id, action, data.id || data.name!, `Category ${data.op}.`);
    });
    return ok("Category updated.");
  }
  if (action === "admin-template") {
    need("ADMIN");
    const data = z.object({ key: z.enum(["verify", "reset"]), subject: text(3, 200), body: text(20, 4000) }).parse(payload);
    await serial(async tx => {
      await tx.emailTemplate.upsert({ where: { key: data.key }, create: { ...data, updatedBy: user.id }, update: { subject: data.subject, body: data.body, updatedBy: user.id } });
      await audit(tx, user.id, action, data.key, "Email template updated.");
    });
    return ok("Template saved.");
  }
  if (action === "admin-template-test") {
    need("ADMIN");
    const data = z.object({ key: z.enum(["verify", "reset"]) }).parse(payload);
    await sendMail(user, data.key, { name: user.displayName, url: `${process.env.APP_URL || "http://localhost:3000"}/` });
    return ok("Test email sent to your address. Check the delivery log for the result.");
  }
  if (action === "admin-seo") {
    need("ADMIN");
    const data = z.object({ siteTitle: text(4, 120), siteDescription: text(20, 300), announcement: z.string().max(300).default("") }).parse(payload);
    await serial(async tx => {
      await tx.platformConfig.upsert({ where: { id: "platform" }, create: { id: "platform", ...data, announcement: data.announcement || null }, update: { ...data, announcement: data.announcement || null } });
      await audit(tx, user.id, action, "platform", "Site metadata updated.");
    });
    return ok("Site metadata saved.");
  }
  if (action === "admin-settings") {
    need("ADMIN");
    const data = z.object({ readOnly: z.boolean(), maxAttachments: z.number().int().min(1).max(8), maxAttachmentBytes: z.number().int().min(100_000).max(10_485_760) }).parse(payload);
    await serial(async tx => {
      await tx.platformConfig.upsert({ where: { id: "platform" }, create: { id: "platform", ...data }, update: data });
      await audit(tx, user.id, action, "platform", `Limits: ${data.maxAttachments} attachments, ${data.maxAttachmentBytes} bytes; read-only: ${data.readOnly}.`);
    });
    return ok("Platform settings saved.");
  }
  throw new AppError("Unknown action.", 404);
}
