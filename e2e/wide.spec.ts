import { devices, expect, test } from "@playwright/test";
import { LIST_ID, list, mockBackend } from "./fixtures";

// From 840 px the pool is a column beside the board, with the count and the
// buttons above it, and it stays in view while a long board scrolls.
test.describe("a wide screen", () => {
  test.skip(({ hasTouch }) => hasTouch, "a laptop's layout");

  test("keeps the pool beside the board while the page scrolls", async ({ page }) => {
    await mockBackend(page);
    const tiers = Array.from({ length: 20 }, (_, i) => ({
      label: `T${i + 1}`,
      caption: null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    await page.route(`**/lists/${LIST_ID}`, (route) => route.fulfill({ json: { ...list, tiers } }));
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");

    const side = page.locator(".ranking__side");
    const board = page.locator(".board");
    const sideBox = (await side.boundingBox())!;
    const boardBox = (await board.boundingBox())!;
    expect(sideBox.x).toBeGreaterThanOrEqual(boardBox.x + boardBox.width - 1);
    await expect(page.locator(".pool__items")).toHaveCSS("display", "grid");
    await expect(side.getByRole("button", { name: "Finish" })).toBeVisible();
    await expect(side.getByText("0 of 3 placed")).toBeVisible();

    const header = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")),
    );
    // Over the board: a wheel over the column would scroll the pool instead.
    await page.mouse.move(boardBox.x + 40, boardBox.y + 40);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    await expect
      .poll(async () => Math.round((await side.boundingBox())!.y))
      .toBe(Math.round(header));
    await expect(side.getByRole("button", { name: "Ex Machina" })).toBeInViewport();
  });

  // A wide, tall window docks the pool under the board; the choice to put it beside is kept.
  test("docks the pool under the board on a wide window and remembers a choice", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await mockBackend(page);
    // Twelve tiers, so the page is taller than the window and the dock has something to stick to.
    const tiers = Array.from({ length: 12 }, (_, i) => ({
      label: `T${i + 1}`,
      caption: null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    await page.route(`**/lists/${LIST_ID}`, (route) => route.fulfill({ json: { ...list, tiers } }));
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    const board = page.locator(".ranking");
    await expect(board).toHaveClass(/ranking--under/);
    await expect(page.locator(".pool")).toHaveCSS("position", "fixed");
    await expect(page.locator(".list-head").getByRole("button", { name: "Finish" })).toBeVisible();
    const poolBox = (await page.locator(".pool").boundingBox())!;
    expect(Math.round(poolBox.y + poolBox.height)).toBe(900);
    // The page keeps room under the board for the dock: the footer waits, and at
    // the end of the scroll the dock is still at the foot with the last row 24 px
    // above its edge.
    await expect(page.locator(".foot")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--dock-h")))
      .toMatch(/^\d+px$/);
    // The dock's shadow says a row is underneath it; at the end of the scroll it goes.
    await expect(page.locator(".pool")).toHaveClass(/pool--over/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const endBox = (await page.locator(".pool").boundingBox())!;
    expect(Math.round(endBox.y + endBox.height)).toBe(900);
    const lastTier = (await page.locator(".tier").last().boundingBox())!;
    expect(Math.round(endBox.y - (lastTier.y + lastTier.height))).toBe(24);
    await expect(page.locator(".pool")).not.toHaveClass(/pool--over/);
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.getByRole("button", { name: "Cards beside the board" }).click();
    await expect(board).not.toHaveClass(/ranking--under/);
    await expect(page.locator(".ranking__side")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    await expect(page.locator(".ranking")).not.toHaveClass(/ranking--under/);
    await page.getByRole("button", { name: "Cards under the board" }).click();
    await expect(page.locator(".ranking")).toHaveClass(/ranking--under/);
  });

  // The /r/ page: the panel with the chips, the invitation, the link and the picture beside the board.
  test("stands the ranking's handout beside its board", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/api/rank/abcdefgh", (route) =>
      route.fulfill({
        json: {
          code: "abcdefgh",
          listId: LIST_ID,
          listAvailable: true,
          createdAt: 0,
          rows: [[1], [0]],
          snapshot: {
            title: list.title,
            authorName: list.authorName,
            authorPhotoUrl: null,
            category: list.category,
            tiers: list.tiers,
            items: list.items,
          },
        },
      }),
    );
    await page.goto("/r/abcdefgh");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    const side = page.locator(".ranking--read .ranking__side");
    const boardBox = (await page.locator(".board").first().boundingBox())!;
    const sideBox = (await side.boundingBox())!;
    expect(sideBox.x).toBeGreaterThanOrEqual(boardBox.x + boardBox.width - 1);
    await expect(side.getByRole("link", { name: "Rank this list" })).toHaveAttribute(
      "href",
      `/l/${LIST_ID}`,
    );
    await expect(side.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(side.getByRole("button", { name: "Download image" })).toBeVisible();
  });

  // The bar's search field, a laptop's way to the search page.
  test("searches from the bar", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/lists?**", (route) =>
      route.fulfill({ json: { lists: [list], nextCursor: null } }),
    );
    await page.goto("/about");
    const box = page.getByRole("banner").getByRole("searchbox", { name: "Search lists" });
    await box.fill("anime");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=anime$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("“anime”");
    await expect(box).toHaveValue("anime");
  });

  // A tablet held upright: the docked tray one size up, rows one size down.
  test("docks a taller tray on a tablet held upright", async ({ browser }) => {
    const tablet = await browser.newContext({ ...devices["iPad (gen 7)"] });
    const page = await tablet.newPage();
    await mockBackend(page);
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");

    const pool = page.locator(".pool");
    await expect(pool).toHaveCSS("position", "fixed");
    const tile = (await page.getByRole("button", { name: "Ex Machina" }).boundingBox())!;
    expect([Math.round(tile.width), Math.round(tile.height)]).toEqual([56, 78]);
    const band = (await page.locator(".tier__band").first().boundingBox())!;
    expect(Math.round(band.width)).toBe(80);
    await expect(page.getByRole("button", { name: "Copy link" })).toBeHidden();
    await tablet.close();
  });
});
