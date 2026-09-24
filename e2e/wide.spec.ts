import { expect, test } from "@playwright/test";
import { LIST_ID, list, mockBackend } from "./fixtures";

// From 840 px the pool is a column beside the board, with the count and the
// buttons above it, and it stays in view while a long board scrolls.
test.describe("a wide screen", () => {
  test.skip(({ hasTouch }) => hasTouch, "a laptop's layout");

  test("keeps the pool beside the board while the page scrolls", async ({ page }) => {
    await mockBackend(page);
    const tiers = Array.from({ length: 12 }, (_, i) => ({
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
});
