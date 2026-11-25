import { expect, test } from "@playwright/test";
import { LIST_ID, list } from "./fixtures";
import { ME, signIn } from "./signedIn";

// The author's own list, seen as others see it: its head and its tier rows
// share both edges at every width (the Designer, 23.11; the head stood off the rows),
// and those are the page column's, the bar's logo and buttons on them: the
// board was 1120 in a 2560 window's middle (Danylo's walk, 25.11).
test("the author's list page lines its head up with its rows", async ({ page }, info) => {
  test.skip(info.project.use.hasTouch === true, "a laptop's layout");
  await signIn(page);
  await page.route(`**/lists/${LIST_ID}`, (route) =>
    route.fulfill({
      json: { ...list, authorUid: ME.uid, authorName: ME.name, anonymous: false },
    }),
  );
  for (const width of [840, 1200, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/l/${LIST_ID}`);
    const title = page.locator(".list-head__text");
    await expect(title).toBeVisible();
    const board = page.locator(".list-page > .board");
    await expect(board).toBeVisible();
    const head = (await page.locator(".list-head").evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        left: box.left + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.paddingRight),
      };
    }))!;
    const rows = (await board.boundingBox())!;
    expect(Math.abs(head.left - rows.x), `${width}px left`).toBeLessThanOrEqual(1);
    expect(Math.abs(head.right - (rows.x + rows.width)), `${width}px right`).toBeLessThanOrEqual(1);
    expect(Math.round(rows.width), `${width}px board`).toBe(Math.min(width - 64, 1760));
    const brand = (await page.locator(".top .brand").boundingBox())!;
    const actions = (await page.locator(".top__actions").boundingBox())!;
    expect(Math.abs(brand.x - rows.x), `${width}px logo`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(actions.x + actions.width - (rows.x + rows.width)),
      `${width}px buttons`,
    ).toBeLessThanOrEqual(1);
  }
});
