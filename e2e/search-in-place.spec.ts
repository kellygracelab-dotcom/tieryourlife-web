import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

/*
 * A section's or a topic's page searches inside itself first, as the app
 * does: a chip in the field says where, and its cross searches everywhere.
 * The bar's field from 720 px; below that the bar's icon leads to the search
 * page, whose own box carries the chip.
 */

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

const pokemon = {
  id: "t1",
  name: "Pokémon",
  section: "games",
  status: "approved",
  listCount: 10,
  followerCount: 100,
  following: false,
  mergedInto: null,
  pictureUrl: null,
};

/** The backend as the place's pages and the search page ask it; what the feed was asked, kept. */
async function backend(page: Page): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await mockBackend(page);
  await page.route("**/lists/sections", (route) =>
    route.fulfill({
      json: {
        sections: [
          {
            id: "games",
            listCount: 9,
            followerCount: 1,
            newThisWeek: 0,
            collage: [],
            following: false,
          },
        ],
      },
    }),
  );
  await page.route("**/lists/topics?**", (route) => route.fulfill({ json: { topics: [pokemon] } }));
  await page.route("**/lists/topics/t1", (route) => route.fulfill({ json: pokemon }));
  await page.route("**/lists?**", (route) => {
    asked.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { lists: [summary], nextCursor: null } });
  });
  return asked;
}

const narrow = (testInfo: TestInfo) =>
  testInfo.project.name === "phone" || testInfo.project.name === "iphone";

/** The field that searches on this width: the bar's, or on a phone the search page's own. */
async function fieldFor(page: Page, place: string, testInfo: TestInfo) {
  if (narrow(testInfo)) {
    await page
      .getByRole("banner")
      .getByRole("link", { name: `Search in ${place}` })
      .click();
    return page.getByRole("main").getByRole("searchbox", { name: `Search in ${place}` });
  }
  return page.getByRole("banner").getByRole("searchbox", { name: `Search in ${place}` });
}

test("a section's page searches the section, and the chip's cross searches everywhere", async ({
  page,
}, testInfo) => {
  const asked = await backend(page);
  await page.goto("/s/games");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Games");

  const field = await fieldFor(page, "Games", testInfo);
  await expect(field).toBeVisible();
  const chip = field.locator("xpath=..").getByText("in Games");
  await expect(chip).toBeVisible();
  // The chip sits in the field, before the words.
  const [chipBox, fieldBox] = await Promise.all([chip.boundingBox(), field.boundingBox()]);
  expect(chipBox && fieldBox && chipBox.x < fieldBox.x).toBe(true);

  await field.fill("zelda");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=zelda&category=games$/);
  await expect
    .poll(() => asked.some((q) => q.get("q") === "zelda" && q.get("category") === "games"))
    .toBe(true);

  // From the keyboard: back from the words to the cross, and Enter.
  const searchbox = narrow(testInfo)
    ? page.getByRole("main").getByRole("searchbox")
    : page.getByRole("banner").getByRole("searchbox");
  await searchbox.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Search everywhere" }).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=zelda$/);
  await expect(searchbox).toBeFocused();
  await expect(page.getByText("in Games")).toHaveCount(0);
  await expect
    .poll(() => asked.some((q) => q.get("q") === "zelda" && !q.has("category")))
    .toBe(true);
});

test("a topic's page searches the topic's lists", async ({ page }, testInfo) => {
  const asked = await backend(page);
  await page.goto("/s/games/t/t1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pokémon");

  const field = await fieldFor(page, "Pokémon", testInfo);
  await field.fill("best");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=best&category=games&topic=t1$/);
  await expect
    .poll(() => asked.some((q) => q.get("q") === "best" && q.get("topic") === "t1"))
    .toBe(true);
  await expect(page.getByRole("link", { name: new RegExp(list.title) })).toBeVisible();
});

test("other pages search everywhere, with no chip", async ({ page }, testInfo) => {
  await backend(page);
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  if (narrow(testInfo)) {
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Search lists" }),
    ).toHaveAttribute("href", "/search");
  } else {
    await expect(
      page.getByRole("banner").getByRole("searchbox", { name: "Search lists" }),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Search everywhere" })).toHaveCount(0);
});
