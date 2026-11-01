import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

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

test("hides a list from its menu, with a way back in the snackbar and on the page", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);

  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Hide this list" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Whose arrangement to show" })).toBeHidden();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("group", { name: "Whose arrangement to show" })).toBeVisible();

  // Hidden for good this time: the page says so after a reload too.
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Hide this list" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
  await page.getByRole("button", { name: "Unhide" }).click();
  await expect(page.getByRole("group", { name: "Whose arrangement to show" })).toBeVisible();
});

test("asks a guest to sign in before reporting, and offers to hide instead", async ({ page }) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Report this list" }).click();
  const ask = page.getByRole("dialog", { name: "Sign in to report" });
  await expect(ask).toContainText("Reports go to a person");
  await ask.getByRole("button", { name: "Hide instead" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
});

test("a guest's settings: the theme on this device, and the privacy policy", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/settings");
  await expect(page.getByText("Sign in to change your settings.")).toBeVisible();
  await page.getByRole("radio", { name: "Dark" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(19, 19, 24)");
  await expect(page.getByRole("link", { name: /Privacy policy/ }).first()).toHaveAttribute(
    "href",
    "/privacy.html",
  );
  await page.getByRole("radio", { name: "System" }).first().click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

test("an author's page from a card, with a follow that asks a guest to sign in", async ({
  page,
}) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [summary], nextCursor: null } }),
  );
  await page.route(`**/lists/follow/${list.authorUid}`, (route) =>
    route.fulfill({ json: { following: false, followers: 3 } }),
  );

  await page.goto("/");
  // The card names the author alone, as the app's does.
  await page.getByRole("link", { name: "danylo", exact: true }).first().click();
  await expect(page).toHaveURL(`/u/${list.authorUid}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("danylo");
  await expect(page.getByRole("link", { name: /Every A24 film, ranked/ })).toBeVisible();
  // A small count makes the place look empty, a big one is noise: the page says neither.
  await expect(page.getByText(/followers?|public lists?/)).toHaveCount(0);

  await page.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to follow" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the foot of every page leads to the credits, with TMDB's logo and sentence", async ({
  page,
}) => {
  await mockBackend(page);
  // A board page hides the foot while its tray or dock is up; the settings
  // page keeps it at every width. The foot is drawn before the page is:
  // pressed then, the link is aimed at where it was. A person waits too.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(
    page.getByText("This product uses the TMDB API but is not endorsed or certified by TMDB."),
  ).toBeVisible();
  const logo = page.getByRole("img", { name: "TMDB" });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test("a menu closes on a press anywhere else, and a new page opens at its top", async ({
  page,
}) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [summary], nextCursor: null } }),
  );
  await page.route(`**/lists/follow/${list.authorUid}`, (route) =>
    route.fulfill({ json: { following: false, followers: 3 } }),
  );
  await page.goto(`/l/${list.id}`);
  await page.getByLabel("More about this list").click();
  await expect(page.getByRole("button", { name: "Hide this list" })).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(page.getByRole("button", { name: "Hide this list" })).toBeHidden();

  // The page a link leads to used to open as far down as the one it was pressed on.
  await page.evaluate(() => {
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 1200);
  });
  await page.getByRole("link", { name: "by danylo" }).click();
  await expect(page).toHaveURL(`/u/${list.authorUid}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("danylo");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

/** A section's topics as the backend sends them: one with a picture of its own, the rest without. */
const topics = ["Pokémon", "Indies", "Speedruns", "Retro", "Roguelikes"].map((name, index) => ({
  id: `t${index + 1}`,
  name,
  section: "games",
  status: "approved",
  listCount: 10,
  followerCount: 100 - index,
  following: false,
  mergedInto: null,
  pictureUrl: index === 0 ? "https://pictures.test/pokemon.svg" : null,
}));

const PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#e0b84a"/><circle cx="80" cy="50" r="30" fill="#c0392b"/></svg>';

test("a section's topics are tiles, two to a phone's row, and a tile opens the topic's page", async ({
  page,
}, testInfo) => {
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
  await page.route("**/lists/topics?**", (route) => route.fulfill({ json: { topics } }));
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [summary], nextCursor: null } }),
  );
  await page.route("https://pictures.test/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: PICTURE }),
  );
  await page.goto("/s/games");

  const grid = page.getByRole("navigation", { name: "Topics" });
  await expect(grid.getByRole("link")).toHaveCount(topics.length);
  // Tiles at least 170 px wide besides the gaps, and never fewer than two in a row:
  // two on a phone, five across the desktop's page, as the app counts.
  const { columns, width } = await grid.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    width: element.clientWidth,
  }));
  expect(columns).toBe(Math.max(2, Math.floor((width + 12) / 182)));
  const phone = testInfo.project.name === "phone" || testInfo.project.name === "iphone";
  expect(columns).toBe(phone ? 2 : Math.floor(width / 170));
  const tile = await grid.getByRole("link").first().boundingBox();
  if (tile === null) throw new Error("no tile");
  expect(tile.width / tile.height).toBeCloseTo(2, 1);

  await grid.getByRole("link", { name: "Pokémon" }).click();
  await expect(page).toHaveURL("/s/games/t/t1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pokémon");
  await expect(page.getByRole("link", { name: /Every A24 film, ranked/ })).toBeVisible();
  await page.getByRole("link", { name: "Navigate back" }).click();
  await expect(page).toHaveURL("/s/games");
});

test("shows the Android app card at the top of the home page, the search still in sight", async ({
  page,
}, testInfo) => {
  await mockBackend(page);
  await page.goto("/");
  const card = page.getByRole("heading", { name: "TierYourLife for Android" });
  // Never on an iPhone or iPad: the app is Android's only.
  if (testInfo.project.name === "iphone") {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(card).toHaveCount(0);
    return;
  }
  await expect(card).toBeInViewport();
  await expect(page.getByRole("searchbox")).toBeInViewport();
});
