import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

const summary = (n: number, authorName: string) => ({
  id: `fresh${n}`,
  title: `New list ${n + 1}`,
  authorUid: `author${n}`,
  authorName,
  authorPhotoUrl: null,
  category: list.category,
  itemCount: 24,
  coverImageUrl: null,
  previewImages: [],
  tierColors: list.tierColors,
  updatedAt: list.updatedAt,
  takeCount: 0,
});

// Marketing's decision (23.11): people's newest lists in one row over Popular,
// each card naming its author; the row scrolls across rather than growing down.
test("Explore shows New from the community over Popular, in one row", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    new URL(route.request().url()).searchParams.get("fresh") === "1"
      ? route.fulfill({
          json: {
            lists: Array.from({ length: 9 }, (_, n) =>
              summary(n, n % 2 === 0 ? "Danylo Petrov" : "olena"),
            ),
          },
        })
      : route.fulfill({ json: { lists: [summary(20, "house")], nextCursor: null } }),
  );
  await page.goto("/");
  const fresh = page.getByRole("heading", { level: 2, name: "New from the community" });
  const popular = page.getByRole("heading", { level: 2, name: "Popular" });
  await expect(fresh).toBeVisible();
  await expect(popular).toBeVisible();
  expect((await fresh.boundingBox())!.y).toBeLessThan((await popular.boundingBox())!.y);

  const row = page.getByRole("list", { name: "New from the community" });
  const cards = row.locator(":scope > li");
  await expect(cards).toHaveCount(9);
  const tops = await cards.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().top));
  expect(new Set(tops.map(Math.round)).size).toBe(1);
  // It scrolls across inside itself; the page does not.
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(row.getByRole("link", { name: "Danylo Petrov" }).first()).toBeVisible();
});
