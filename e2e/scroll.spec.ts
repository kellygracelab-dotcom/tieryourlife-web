import { expect, test } from "@playwright/test";
import { mockBackend } from "./fixtures";

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
