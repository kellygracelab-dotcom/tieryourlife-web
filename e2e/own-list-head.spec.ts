import { expect, test } from "@playwright/test";
import { LIST_ID, list } from "./fixtures";
import { ME, signIn } from "./signedIn";

// The author's own list, seen as others see it: its head and its tier rows
// share both edges at every width (the Designer, 23.11; the head stood off the rows).
test("the author's list page lines its head up with its rows", async ({ page }, info) => {
  test.skip(info.project.use.hasTouch === true, "a laptop's layout");
  await signIn(page);
  await page.route(`**/lists/${LIST_ID}`, (route) =>
    route.fulfill({
      json: { ...list, authorUid: ME.uid, authorName: ME.name, anonymous: false },
    }),
  );
  for (const width of [840, 1200, 1440, 1920]) {
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
  }
});
