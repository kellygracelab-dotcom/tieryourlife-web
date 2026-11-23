import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

const summary = (n: number) => ({
  id: `row${n}`,
  title: `List ${n + 1}`,
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
});

// Popular with more to come shows whole rows only, at every width the feed
// has a different number of columns; Show more brings the rest, and the last
// page shows all it has (Danylo's screenshot, 23.11: four places blank in eight).
test("the feed shows whole rows above Show more, and every card on its last page", async ({
  page,
}) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.request().url().includes("p2")
      ? route.fulfill({
          json: { lists: Array.from({ length: 5 }, (_, n) => summary(20 + n)), nextCursor: null },
        })
      : route.fulfill({
          json: { lists: Array.from({ length: 20 }, (_, n) => summary(n)), nextCursor: "p2" },
        }),
  );
  const cards = page.locator(".home .feed > li");
  const columns = () =>
    page
      .locator(".home .feed")
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  for (const width of [390, 700, 1000, 1500, 2000, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(cards.first()).toBeVisible();
    const across = await columns();
    const shown = await cards.count();
    expect(shown % across, `${width}px: ${shown} cards in ${across} columns`).toBe(0);
    expect(shown).toBe(20 - (20 % across));
  }
  // At 2560 the cards left over come first after Show more, and the last page shows all 25.
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(cards).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
});
