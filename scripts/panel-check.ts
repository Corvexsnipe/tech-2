import { chromium, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const PANEL = "/review-matter-panel";

// Read existing records; use temporary accounts/sessions and intercept writes.
// No email, moderation, role, or configuration changes are sent by this UI check.
async function main() {
  const { db } = await import("../src/lib/db");
  const prisma = db();
  const browser = await chromium.launch({ args: ["--disable-extensions"] });
  const created: string[] = [];
  const errors: string[] = [];
  try {
    const admin = await prisma.user.create({ data: { email: `panel-ui-${Date.now()}@example.invalid`, displayName: "Design Check", passwordHash: "disabled", verifiedAt: new Date(), role: "SUPER_ADMIN" } });
    created.push(admin.id);
    const token = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId: admin.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // The Next.js dev overlay portal overlaps the sidebar footer; it is a dev artifact, not app UI.
    // Passed as a string: a function would carry the test-file transform's `__name` helper into the page.
    await context.addInitScript({
      content: `(function(){var remove=function(){document.querySelectorAll("nextjs-portal").forEach(function(el){el.remove()})};new MutationObserver(remove).observe(document,{childList:true,subtree:true});remove()})()`,
    });
    await context.addCookies([{ name: process.env.TARGET_ENV === "production" ? "__Host-rm_session" : "rm_session", value: token, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax", secure: process.env.TARGET_ENV === "production" }]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", e => errors.push(`${e.message.slice(0, 120)} [@${new URL(page.url()).pathname}] :: ${(e.stack ?? "").split("\n")[1]?.trim().slice(0, 160)}`));
    page.on("console", m => { if (m.type() === "error" && /hydrat|didn't match|invalid.*nest/i.test(m.text())) errors.push(`${m.text().slice(0, 200)} [@${new URL(page.url()).pathname}]`); });
    await mkdir("test-results", { recursive: true });
    const [business, review, ticket] = await Promise.all([
      prisma.business.findFirst({ select: { id: true } }),
      prisma.review.findFirst({ orderBy: { attachments: { _count: "desc" } }, select: { id: true } }),
      prisma.ticket.findFirst({ select: { id: true } }),
    ]);
    const paths = ["", "/users", "/businesses", "/claims", "/reviews", "/attachments", "/reports", "/security", "/ips", "/support", "/categories", "/analytics", "/notifications", "/team", "/audit", "/settings", "/seo", "/system", "/search?q=test",
      `/users/${admin.id}`, ...(business ? [`/businesses/${business.id}`] : []), ...(review ? [`/reviews/${review.id}`] : []), ...(ticket ? [`/support/${ticket.id}`] : [])];
    const widths = process.env.PANEL_CHECK_WIDTHS?.split(",").map(Number) || [1440, 768, 390];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of paths) {
        const response = await page.goto(`${BASE}${PANEL}${path}`, { waitUntil: "networkidle", timeout: 90000 });
        expect(response?.status(), path).toBe(200);
        await expect(page.locator(".panel-content h1"), path).toBeVisible();
        await expect(page.locator(".panel-content")).not.toContainText("Something went wrong");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        if (overflow) {
          const offenders = await page.locator(".panel-content *").evaluateAll(nodes => nodes.filter(el =>
            el.getBoundingClientRect().right > innerWidth + 2 && getComputedStyle(el).position !== "absolute"
            && !el.closest(".data-table,[style*='overflow']")).slice(0, 8).map(el => `${el.tagName}.${el.className}`));
          throw new Error(`Overflow ${width}px ${path || "/"}: ${offenders.join(", ")}`);
        }
        if (path === "" || path === "/users" || path === "/security" || path === "/settings") {
          await page.screenshot({ path: `test-results/panel-${path.replace("/", "") || "overview"}-${width}.png`, fullPage: true });
        }
        console.log(`PASS ${width}px ${PANEL}${path}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}${PANEL}`, { waitUntil: "networkidle" });
    await expect(page.locator(".panel-nav a")).toHaveCount(18);
    // dispatchEvent bypasses the dev-overlay portal overlapping the sidebar footer (dev-only artifact).
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).dispatchEvent("click");
    await expect(page.locator(".panel-shell")).toHaveClass(/collapsed/);
    await expect(page.locator('.panel-nav a[aria-label="Review IP Log"]')).toHaveAttribute("title", "Review IP Log");
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).dispatchEvent("click");
    await page.getByLabel("Account menu").click();
    await expect(page.getByRole("link", { name: "Account settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".panel-profile")).not.toHaveAttribute("open", "");
    await page.getByText("View daily values", { exact: true }).click();
    await expect(page.locator(".chart-data table")).toBeVisible();
    await page.locator(".range-bar").getByRole("link", { name: "30 days", exact: true }).click();
    await expect(page).toHaveURL(/range=30d/);
    await expect(page.locator(".activity-panel .badge")).toHaveText("Last 30 days");
    await page.getByLabel("Global admin search").fill("Design Check");
    await page.getByLabel("Global admin search").press("Enter");
    await expect(page).toHaveURL(/search\?q=Design/);
    await expect(page.locator(".panel-content")).toContainText("Design Check");
    await page.goto(`${BASE}${PANEL}/users`, { waitUntil: "networkidle" });
    await page.locator('.search-bar input[name="q"]').fill("Design Check");
    await page.locator(".search-bar button[type=submit], .search-bar button").first().click();
    await expect(page.locator(".data-table")).toContainText("Design Check");
    console.log("PASS collapse, tooltips, account menu, chart values, date range, global and list search");

    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}${PANEL}`, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await expect(page.locator(".panel-sidebar")).toBeVisible();
      await expect(page.locator(".panel-main")).toHaveAttribute("inert", "");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await page.locator('.panel-nav a[aria-label="Security Center"]').click();
      await expect(page).toHaveURL(/\/security$/);
      await expect(page.locator(".panel-main")).not.toHaveAttribute("inert", "");
    }
    console.log("PASS mobile drawer navigation, focus restoration, Escape and 320px layout");

    // Verify the existing forms' payloads and feedback without changing real records.
    const requests: { action: string; data: Record<string, unknown> }[] = [];
    let reject = false;
    await page.route("**/api/action", async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: reject ? 403 : 200, contentType: "application/json", body: JSON.stringify(reject ? { error: "UI test: permission denied" } : { message: "UI test: saved" }) });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}${PANEL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Save policy", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "UI test: saved" })).toBeVisible();
    expect(requests.at(-1)?.action).toBe("admin-config");
    reject = true;
    await page.getByRole("button", { name: "Save limits", exact: true }).click();
    await expect(page.locator(".notice[role=alert]")).toContainText("UI test: permission denied");
    reject = false;
    if (review) {
      await page.goto(`${BASE}${PANEL}/reviews/${review.id}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Assign case", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "UI test: saved" })).toBeVisible();
      expect(requests.at(-1)?.action).toBe("admin-review-assign");
      if (await page.getByRole("button", { name: /Check Proof/ }).count()) {
        await page.getByRole("button", { name: /Check Proof/ }).first().click();
        await expect(page.locator("dialog[open]")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
      }
    }
    if (ticket) {
      await page.goto(`${BASE}${PANEL}/support/${ticket.id}`, { waitUntil: "networkidle" });
      await page.locator('textarea[name="body"]').fill("UI verification only. No message is sent.");
      await page.getByRole("button", { name: /Send reply/ }).click();
      await expect(page.getByRole("status").filter({ hasText: "UI test: saved" })).toBeVisible();
      expect(requests.at(-1)?.action).toBe("admin-ticket-reply");
      await expect(page.locator('textarea[name="body"]')).toHaveValue("");
    }
    console.log("PASS form success/errors, assignment, proof dialog and ticket reply UI (writes intercepted)");
    await page.getByLabel("Account menu").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    expect(requests.at(-1)?.action).toBe("logout");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${BASE}${PANEL}`, { waitUntil: "networkidle" });
    await expect(page.locator(".panel-content")).toHaveCSS("opacity", "1");
    const publicPage = await browser.newPage();
    await publicPage.goto(`${BASE}${PANEL}`, { waitUntil: "networkidle" });
    await expect(publicPage).toHaveURL(/sign-in/);
    await publicPage.goto(BASE, { waitUntil: "networkidle" });
    expect(await publicPage.locator(".panel-shell").count()).toBe(0);
    expect(await publicPage.locator("body").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(errors, "browser runtime/hydration errors").toEqual([]);
    console.log(`PASS anonymous access, public theme isolation and reduced motion; ${paths.length} admin routes checked at ${widths.length} sizes; no browser errors`);
  } finally {
    await browser.close();
    await prisma.session.deleteMany({ where: { userId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Panel check failed"); process.exitCode = 1; });
