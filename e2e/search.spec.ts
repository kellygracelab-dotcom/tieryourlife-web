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

test("search from the front page, then narrow the order", async ({ page }) => {
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

  await page.getByRole("button", { name: "Newest" }).click();
  await expect(page).toHaveURL(/sort=recent/);
  await expect.poll(() => asked.at(-1)).toContain("sort=recent");

  await box.fill("nothing here");
  await expect(page.getByText("Nothing with that name yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "the front page" })).toHaveAttribute("href", "/");
});
