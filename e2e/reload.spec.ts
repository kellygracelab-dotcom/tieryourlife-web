import { expect, test, type Page } from "@playwright/test";
import { list, mockBackend, nameNewList } from "./fixtures";
import { signIn } from "./signedIn";

/*
 * A reload goes from the board to the board. The browser keeps showing the
 * old page until the new one draws something, so a skeleton drawn first reads
 * as the board vanishing and coming back (Danylo, 15.11.2026). One's own board
 * is on this device, a published list is in the page's own HTML: neither has
 * anything to wait for.
 */

// Every frame from the first, as what it shows: the board, a skeleton, nothing yet.
const WATCH = () => {
  const seen: string[] = [];
  (window as unknown as { __seen: string[] }).__seen = seen;
  const look = () => {
    const board = document.querySelector(".tier, .board") !== null;
    const busy = document.querySelector("[aria-busy='true']") !== null;
    const now = board ? "board" : busy ? "skeleton" : "nothing";
    if (seen[seen.length - 1] !== now) seen.push(now);
  };
  new MutationObserver(look).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  const frame = () => {
    look();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

async function reloadSeen(page: Page): Promise<string[]> {
  await page.addInitScript(WATCH);
  await page.reload();
  await expect(page.locator(".tier").first()).toBeVisible();
  // A late answer or the account arriving must not take it away either.
  await page.waitForTimeout(1500);
  return page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
}

async function ownBoard(page: Page) {
  await page.goto("/b/new");
  await nameNewList(page, "Reloaded board");
  await expect(page.locator(".tier").first()).toBeVisible();
  // At its own address, as a reload finds it.
  await page.goto(new URL(page.url()).pathname);
  await expect(page.locator(".tier").first()).toBeVisible();
}

// The page function's copy of the list, as production serves /l/.
async function servedWithList(page: Page) {
  await page.route(`**/l/${list.id}`, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const preload = JSON.stringify({ kind: "list", list }).replace(/</g, "\\u003c");
    const html = (await response.text()).replace(
      "</head>",
      `<script id="tyl-preload" type="application/json">${preload}</script></head>`,
    );
    await route.fulfill({ response, body: html });
  });
}

test.describe("a reload keeps the board", () => {
  test("one's own board, as a guest", async ({ page }) => {
    await mockBackend(page);
    await ownBoard(page);
    expect(await reloadSeen(page)).toEqual(["nothing", "board"]);
  });

  test("one's own board, signed in", async ({ page }) => {
    await signIn(page);
    await ownBoard(page);
    expect(await reloadSeen(page)).toEqual(["nothing", "board"]);
  });

  test("a published list, as a guest", async ({ page }) => {
    await mockBackend(page);
    await servedWithList(page);
    await page.goto(`/l/${list.id}`);
    await expect(page.locator(".tier").first()).toBeVisible();
    expect(await reloadSeen(page)).toEqual(["nothing", "board"]);
  });

  test("a published list, signed in", async ({ page }) => {
    await signIn(page);
    await servedWithList(page);
    await page.goto(`/l/${list.id}`);
    await expect(page.locator(".tier").first()).toBeVisible();
    expect(await reloadSeen(page)).toEqual(["nothing", "board"]);
  });
});
