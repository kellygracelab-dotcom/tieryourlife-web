import { expect, test } from "@playwright/test";
import { list } from "./fixtures";

const summary = {
  id: list.id,
  title: list.title,
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
};

test("search from the front page, with no order to choose while searching", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/lists?**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const found = url.searchParams.get("q") === "a24";
    return route.fulfill({ json: { lists: found ? [summary] : [], nextCursor: null } });
  });
  await page.route("**/fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/fonts.gstatic.com/**", (route) => route.abort());

  await page.goto("/");
  const box = page.getByRole("searchbox");
  await box.fill("a24");
  await box.press("Enter");

  await expect(page).toHaveURL(/\/search\?q=a24$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("“a24”");
  await expect(page.getByRole("link", { name: /Every A24 film, ranked/ })).toHaveAttribute(
    "href",
    `/l/${list.id}`,
  );
  await expect(page.getByText("1 list")).toBeVisible();

  // A search is ordered by title on the backend, so it offers no order to choose.
  await expect(page.getByRole("button", { name: "Newest" })).toHaveCount(0);

  // On a laptop the box is the bar's now, which searches on Enter; a phone's page box follows the typing.
  await box.fill("nothing here");
  await box.press("Enter");
  await expect(page.getByText("No lists match “nothing here”")).toBeVisible();
  await expect(page.getByRole("link", { name: "the front page" })).toHaveAttribute("href", "/");
});

test("a search narrowed to a section asks the backend for that section", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/lists?**", (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { lists: [summary], nextCursor: null } });
  });
  await page.goto("/search?q=a24");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("“a24”");
  await page.getByRole("button", { name: "Film & TV" }).click();
  await expect(page).toHaveURL(/category=film_tv/);
  await expect
    .poll(() => asked.some((search) => search.includes("category=film_tv")), { timeout: 15_000 })
    .toBe(true);
});
