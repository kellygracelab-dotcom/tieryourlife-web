import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

/*
 * A page opened by its address starts at its top. Every full load begins at
 * an entry the router names "default", so a scroll kept under that name
 * carried the last page's place into the next one: a shared list opened past
 * its title, the settings halfway down.
 */
test("a page opened by its address starts at the top, whatever was scrolled before", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Room enough to scroll whatever the page holds.
  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
    window.scrollTo(0, 1500);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

  await page.goto("/l/abc");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => (document.body.style.minHeight = "4000px"));
  // Whatever the restoring does, it has done it by the next frames.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

/*
 * Back to a search returns to where the person was. The page first draws a
 * spinner while its topics come in, too short for that place, so the
 * browser stopped near the top unless the place is taken again once the
 * page has grown.
 */
test("Back to a search returns to the place, though the page waits for its topics", async ({
  page,
}) => {
  await mockBackend(page);
  const lists = Array.from({ length: 24 }, (_, n) => ({
    id: n === 0 ? list.id : `other${n}`,
    title: `${list.title} ${n}`,
    authorUid: list.authorUid,
    authorName: list.authorName,
    authorPhotoUrl: null,
    category: list.category,
    itemCount: list.itemCount,
    coverImageUrl: null,
    previewImages: [],
    tierColors: list.tierColors,
    updatedAt: list.updatedAt,
    takeCount: list.takeCount,
  }));
  await page.route("**/lists?**", (route) => route.fulfill({ json: { lists, nextCursor: null } }));
  await page.route("**/lists/topics?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({ json: { topics: [] } });
  });

  await page.goto("/search?q=film");
  const last = page.getByRole("link", { name: new RegExp(`${list.title} 23`) });
  await expect(last).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  const before = await page.evaluate(() => window.scrollY);

  // The last one is in view already: opening it moves nothing first.
  await last.click();
  await expect(page).toHaveURL(/\/l\/other23$/);
  await page.goBack();
  await expect(last).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 5);
});
