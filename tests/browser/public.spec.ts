import { test, expect } from "@playwright/test";

test("homepage, interactive walkthrough, evidence modal, and responsive layout", async ({ page }, testInfo) => {
  const exceptions: string[] = [];
  page.on("pageerror", error => exceptions.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Real Customer");
  await expect(page.getByText("Trusted by Businesses Worldwide")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("tab", { name: /Read reviews/ }).click();
  await expect(page.getByRole("tabpanel").getByText("More than a rating.")).toBeVisible();
  const proof = page.getByRole("tabpanel").getByRole("button", { name: /Check Proof/ });
  await proof.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Illustration — no real purchase or customer data")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(proof).toBeFocused();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("tabpanel").getByText("85 points", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.getByRole("tab", { name: /Read reviews/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Find a business/ }).click();
  await page.getByRole("textbox", { name: "Find a business" }).fill("A real search");
  await page.getByRole("tabpanel").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/explore\?q=A\+real\+search/);
  await expect(page.getByText("No matches just yet.")).toBeVisible();
  expect(exceptions).toEqual([]);
  await page.goto("/");
  await page.screenshot({ path: `test-results/home-${testInfo.project.name}.png`, fullPage: true });
});

test("homepage pointer depth can be paused and respects reduced motion", async ({ page, isMobile }) => {
  await page.goto("/");
  const scene = page.locator(".home-hero-scene");
  const surface = scene.locator(".pointer-surface");
  const box = await scene.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .7);
  if (isMobile) {
    await expect(surface).toHaveCSS("transform", "none");
  } else {
    // Repeat the move inside the poll so a hydrated-early missed event still registers.
    await expect(async () => {
      await page.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .7);
      await expect(surface).not.toHaveCSS("transform", "none", { timeout: 1200 });
    }).toPass({ timeout: 10000 });
    await page.getByRole("button", { name: "Pause motion" }).click();
    await expect(surface).toHaveCSS("transform", "none");
    await page.mouse.move(box!.x + box!.width * .2, box!.y + box!.height * .3);
    await expect(surface).toHaveCSS("transform", "none");
    await page.getByRole("button", { name: "Resume motion" }).click();
    await expect(async () => {
      await page.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .7);
      await expect(surface).not.toHaveCSS("transform", "none", { timeout: 1200 });
    }).toPass({ timeout: 10000 });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(surface).toHaveCSS("transform", "none");
  await page.getByRole("searchbox", { name: "Search businesses", exact: true }).fill("A real search");
  await page.locator(".hero-search").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/explore\?q=A\+real\+search/);
});

test("public routes and authentication pages render without broken navigation", async ({ page }) => {
  for (const route of ["/explore", "/how-it-works", "/for-businesses", "/privacy", "/terms", "/contact", "/sign-in", "/register", "/forgot-password", "/resend-verification", "/verify-email", "/reset-password"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} has horizontal overflow`).toBe(true);
  }
  await page.goto("/not-a-real-route");
  await expect(page.getByText("This page has moved on.")).toBeVisible();
});

test("protected pages redirect unauthenticated visitors", async ({ page }) => {
  for (const route of ["/account", "/account/settings", "/dashboard", "/claim", "/admin", "/review-matter-panel", "/review-matter-panel/users", "/review-matter-panel/reviews", "/dashboard/not-owned", "/business/not-found/review"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test("server rejects cross-origin writes and protected asset access", async ({ request, baseURL }) => {
  const crossOrigin = await request.post("/api/action", { headers: { origin: "https://attacker.invalid" }, data: { action: "login", data: {} } });
  expect(crossOrigin.status()).toBe(403);
  const unauthorized = await request.post("/api/action", { headers: { origin: baseURL! }, data: { action: "admin-config", data: { minimumReviews: 1 } } });
  expect(unauthorized.status()).toBe(401);
  expect((await request.get("/api/qr/not-owned")).status()).toBe(401);
  expect((await request.get("/api/admin-export?kind=users")).status()).toBe(403);
  expect((await request.get("/api/evidence/private-file")).ok()).toBe(false);
  expect([200, 503]).toContain((await request.get("/api/health")).status());
});

test("contact form responds honestly — saves when configured, setup error otherwise", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("Your name").fill("Preview visitor");
  await page.getByLabel("Email address", { exact: true }).fill("preview@example.org");
  await page.getByLabel("Subject").fill("A development configuration check");
  await page.getByLabel("Your message").fill("This form should report missing configuration instead of pretending to save a message.");
  await page.getByRole("button", { name: "Send message" }).click();
  const feedback = page.locator("form .notice");
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText(/configuration|setup|saved/i);
  await expect(feedback).not.toContainText("Something went wrong");
});

test("reduced motion remains usable and mobile navigation opens", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("tab", { name: /Understand the grades/ }).click();
  await expect(page.getByRole("tabpanel").getByText("85 points", { exact: true })).toBeVisible();
  if (isMobile) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Explore businesses" }).click();
    await expect(page).toHaveURL(/\/explore$/);
  }
});
