import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

const summary = (id: string, title: string) => ({
  id,
  title,
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

// Marketing, 23.11: people's newest lists stand first in Popular with "New",
// up to four, and none of them comes again further down, on any page.
test("Explore puts people's newest lists first in Popular, each once", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await mockBackend(page);
  await page.route("**/lists?**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("fresh") === "1") {
      return route.fulfill({
        json: { lists: [summary("new1", "Fresh one"), summary("pop3", "Fresh and popular")] },
      });
    }
    return url.searchParams.get("after") === "pop19"
      ? route.fulfill({
          json: {
            lists: [summary("new1", "Fresh one"), summary("pop20", "Later")],
            nextCursor: null,
          },
        })
      : route.fulfill({
          json: {
            lists: Array.from({ length: 20 }, (_, n) =>
              n === 3 ? summary("pop3", "Fresh and popular") : summary(`pop${n}`, `Popular ${n}`),
            ),
            nextCursor: "pop19",
          },
        });
  });
  await page.goto("/");
  const feed = page.getByRole("list", { name: "Popular" });
  const cards = feed.locator(":scope > li");
  await expect(cards.first()).toContainText("Fresh one");
  await expect(cards.nth(1)).toContainText("Fresh and popular");
  await expect(feed.locator(".list-card__new")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "New from the community" })).toHaveCount(0);
  // 2 on top and 19 of Popular's 20: whole rows of the grid's columns only.
  const across = await feed.evaluate(
    (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length,
  );
  expect(await cards.count()).toBe(21 - (21 % across));
  await expect(feed.getByText("Fresh and popular")).toHaveCount(1);

  await page.getByRole("button", { name: "Show more" }).click();
  await expect(feed.getByText("Later")).toBeVisible();
  await expect(feed.getByText("Fresh one")).toHaveCount(1);
  await expect(cards).toHaveCount(22);
});
