import { expect, test, type Page } from "@playwright/test";
import { nameNewList } from "./fixtures";
import { signIn } from "./signedIn";

/*
 * Settings → Send usage statistics, on the mocked proxy: the site sends its
 * anonymous counts to POST /lists/stats as the page is hidden, and nothing
 * once the person turns it off.
 */

/** What a browser does as its tab goes to the background. */
const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

test("sends the visit's counts as the page is hidden, with the site's version and language", async ({
  page,
}) => {
  const account = await signIn(page);
  const headers: Record<string, string>[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/lists")) headers.push(request.headers());
  });
  await page.goto("/b");
  // A batch sent as a page unloads may pass the mock by (Chromium): count something here.
  await page.getByRole("link", { name: "New list" }).first().click();
  await nameNewList(page, "Counted");
  await expect(page).toHaveURL(/\/b\/(?!new)[^/]+$/);
  await expect(page.locator(".list-head")).toBeVisible();
  await hide(page);
  await expect.poll(() => account.usageBatches.length).toBeGreaterThan(0);
  const batch = account.usageBatches.at(-1) as Record<string, unknown>;
  expect(batch).toMatchObject({ features: { "board.tier": 1 }, crashedSessions: 0 });
  expect(String(batch.version)).toMatch(/^[0-9A-Za-z._-]{1,24}$/);
  expect(account.publishes).toHaveLength(0);
  expect(headers.some((one) => one["x-tyl-client"]?.startsWith("web/"))).toBe(true);
});

test("sends nothing once Send usage statistics is off", async ({ page }) => {
  const account = await signIn(page);
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: /Send usage statistics/ });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const sentBefore = account.usageBatches.length;

  const headers: Record<string, string>[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/lists")) headers.push(request.headers());
  });
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.goto("/l/abc");
  await hide(page);
  await page.waitForTimeout(500);
  expect(account.usageBatches).toHaveLength(sentBefore);
  expect(headers.length).toBeGreaterThan(0);
  expect(headers.every((one) => one["x-tyl-client"] === undefined)).toBe(true);
});
