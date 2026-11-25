import { expect, test } from "@playwright/test";
import { CATEGORIES } from "../src/api/types";
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

test("hides a list from its menu: the page closes, and says so when opened again, with a way back", async ({
  page,
}) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [summary], nextCursor: null } }),
  );
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);

  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Hide this list" }).click();
  // Opened by its link, nothing of the site is behind it: the page goes home, as the app's screen closes.
  await expect(page).toHaveURL("/");

  // Hidden for good: the page says so when opened again, after a reload too.
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Their ranking" })).toBeHidden();
  await page.getByRole("button", { name: "Unhide" }).click();
  await expect(page.getByRole("region", { name: "Their ranking" })).toBeVisible();
});

test("takes a guest's report with no sign-in, and hides the list at once", async ({ page }) => {
  await mockBackend(page);
  const reports: unknown[] = [];
  await page.route(`**/lists/${list.id}/report`, (route) => {
    reports.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await page.goto(`/l/${list.id}`);
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Report this list" }).click();
  const form = page.getByRole("dialog", { name: "Report this list" });
  await form.getByRole("radio", { name: "Spam or advertising" }).check();
  await form.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Reported, and hidden for you" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
  await expect.poll(() => reports).toEqual([{ reason: "spam", note: null }]);
});

test("a guest's settings: the theme on this device, and the privacy policy", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/settings");
  await expect(page.getByText("Sign in to keep your lists on every device.")).toBeVisible();
  // On a phone the theme is a row whose sheet has the choice; a press there closes it.
  const phone = page.viewportSize()!.width < 600;
  if (phone) await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("radio", { name: "Dark" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(19, 19, 24)");
  await expect(page.getByRole("link", { name: /Privacy policy/ }).first()).toHaveAttribute(
    "href",
    "/privacy.html",
  );
  if (phone) await page.getByRole("button", { name: "Theme" }).click();
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

test("a section's topics are low tiles, two rows at most, then the lists under their own title", async ({
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
  await expect(grid.getByRole("link", { includeHidden: true })).toHaveCount(topics.length);
  // Tiles at least 170 px wide besides the gaps, and never fewer than two in a row:
  // two on a phone, six across a 1280 window's page (its 1216 column since the
  // one page width, Danylo's walk 25.11; five in the old 1016), as the app counts.
  const { columns, width } = await grid.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    width: element.clientWidth,
  }));
  expect(columns).toBe(Math.max(2, Math.floor((width + 12) / 182)));
  const phone = testInfo.project.name === "phone" || testInfo.project.name === "iphone";
  expect(columns).toBe(phone ? 2 : 6);
  // Lower than a list's card, so a topic reads as a way in (section layout, 14.11).
  const tile = await grid.getByRole("link").first().boundingBox();
  if (tile === null) throw new Error("no tile");
  expect(tile.height).toBe(64);
  // The picture at full brightness: darkened only in a strip under the name,
  // the bottom 45% of the tile (15.11.2026).
  const strip = await grid
    .getByRole("link")
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element, "::before").height));
  expect(strip).toBeCloseTo(64 * 0.45 + 1, 0);
  // Two rows while folded; the rest under Show all, in place.
  await expect(grid.getByRole("link")).toHaveCount(Math.min(topics.length, columns * 2));
  if (topics.length > columns * 2) {
    await page.getByRole("button", { name: `Show all ${topics.length} topics` }).click();
    await expect(grid.getByRole("link")).toHaveCount(topics.length);
  }
  // The lists under a line and their own title, with their order beside it.
  const lists = page.getByRole("heading", { level: 2, name: "Lists · 9" });
  await expect(lists).toBeVisible();
  const [gridBottom, listsTop] = await Promise.all([
    grid.evaluate((element) => element.getBoundingClientRect().bottom),
    lists.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(listsTop).toBeGreaterThan(gridBottom + 24);

  await grid.getByRole("link", { name: "Pokémon" }).click();
  await expect(page).toHaveURL("/s/games/t/t1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pokémon");
  await expect(page.getByRole("link", { name: /Every A24 film, ranked/ })).toBeVisible();
  await page.getByRole("link", { name: "Navigate back" }).click();
  await expect(page).toHaveURL("/s/games");
});

test("opens on a list one can open, a phone's first screen too, and keeps the app card small under the lists", async ({
  page,
}, testInfo) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [summary], nextCursor: null } }),
  );
  await page.goto("/");
  // Danylo's release walk: the first screen shows a list, its title, ready to open.
  const popular = page.getByRole("region", { name: "Popular" });
  const first = popular.getByRole("link", { name: /Every A24 film, ranked/ }).first();
  await expect(first).toBeInViewport();
  await expect(page.getByRole("searchbox")).toBeInViewport();
  const card = page.getByRole("complementary", { name: "TierYourLife for Android" });
  // Never on an iPhone or iPad: the app is Android's only.
  if (testInfo.project.name === "iphone") {
    await expect(card).toHaveCount(0);
    return;
  }
  // Under the lists, not above them.
  const [cardBox, listBox] = await Promise.all([card.boundingBox(), first.boundingBox()]);
  expect(cardBox!.y).toBeGreaterThan(listBox!.y + listBox!.height);
  expect(cardBox!.height).toBeLessThanOrEqual(140);
});

// Artboard 20, then Danylo's 2560 walk (25.11): the home stands in the one
// column every page has, 1760 (--width-page), the bar's logo and buttons on
// its edges; the sections in one row, the feed six lists across.
test("a wide window's home keeps to the page column: sections in one row, six lists across", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the desktop layout");
  await mockBackend(page);
  const lists = Array.from({ length: 16 }, (_, n) => ({
    ...summary,
    id: `wide${n}`,
    title: `List ${n + 1}`,
  }));
  await page.route("**/lists?**", (route) => route.fulfill({ json: { lists, nextCursor: null } }));
  await page.setViewportSize({ width: 2560, height: 1271 });
  await page.goto("/");
  const cards = page.locator(".home .feed > li");
  await expect(cards).toHaveCount(16);

  const home = (await page.locator(".home").boundingBox())!;
  expect(Math.round(home.width)).toBe(1760);
  const brand = (await page.locator(".top .brand").boundingBox())!;
  const actions = (await page.locator(".top__actions").boundingBox())!;
  expect(Math.abs(brand.x - home.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actions.x + actions.width - (home.x + home.width))).toBeLessThanOrEqual(1);

  const tiles = page.locator(".home .sections-grid > *");
  const tops = new Set(
    (await tiles.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().top))).map(
      Math.round,
    ),
  );
  expect(await tiles.count()).toBeGreaterThanOrEqual(9);
  expect(tops.size).toBe(1);

  const rows = await cards.evaluateAll((all) =>
    all.map((one) => Math.round(one.getBoundingClientRect().top)),
  );
  expect(rows.filter((top) => top === rows[0])).toHaveLength(6);
});

// Danylo's walk, 25.11: eleven sections fell 5 + 5 + 1 at 1250, "Other"
// alone in a third row. The rows stay even at every width a laptop has.
test("lays eleven sections out in even rows at a laptop's widths", async ({ page, hasTouch }) => {
  test.skip(hasTouch, "the desktop layout");
  await mockBackend(page);
  const stats = (id: string, name?: string) => ({
    id,
    listCount: 3,
    followerCount: 0,
    newThisWeek: 0,
    collage: [],
    following: false,
    status: "approved",
    ...(name === undefined ? {} : { name }),
  });
  await page.route("**/lists/sections", (route) =>
    route.fulfill({
      json: {
        sections: [
          ...CATEGORIES.filter((id) => id !== "other").map((id) => stats(id)),
          stats("street-food", "Street food"),
          stats("board-games", "Board games"),
          stats("other"),
        ],
      },
    }),
  );
  for (const [width, rows] of [
    [1000, [4, 4, 3]],
    [1250, [6, 5]],
    [1440, [6, 5]],
    [1920, [11]],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const tiles = page.locator(".home .sections-grid > a");
    await expect(tiles).toHaveCount(11);
    const tops = (
      await tiles.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().top))
    ).map(Math.round);
    const counts = [...new Set(tops)].map((top) => tops.filter((one) => one === top).length);
    expect(counts, `${width}px`).toEqual(rows);
  }
});

// Danylo's walk, 25.11: on a phone's card the author's name was cut,
// "Danylo Pet…", beside "40 cards". The name takes the line, the count under it.
test("gives the author's name its own line on a phone's card", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "the phone's card");
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({
      json: {
        lists: [{ ...summary, authorUid: "u1", authorName: "Danylo Petrov", itemCount: 240 }],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/");
  const card = page
    .locator(".home .feed .list-card")
    .filter({ has: page.locator(".list-card__name", { hasText: "Danylo Petrov" }) })
    .first();
  await expect(card).toBeVisible();
  const { cut, name, count } = await card.evaluate((one) => {
    const named = one.querySelector<HTMLElement>(".list-card__name")!;
    return {
      cut: named.scrollWidth > named.clientWidth,
      name: named.getBoundingClientRect(),
      count: one.querySelector(".list-card__count")!.getBoundingClientRect(),
    };
  });
  expect(cut).toBe(false);
  expect(count.top).toBeGreaterThanOrEqual(name.bottom - 1);
});

// A browser window as narrow as a phone, with a mouse: the sections' row
// scrolls sideways on the wheel (it moved from the keyboard alone, 17.11),
// and at its end the wheel scrolls the page again.
test("a mouse's wheel turns the narrow home's sections sideways, then the page", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "a mouse");
  await mockBackend(page);
  await page.setViewportSize({ width: 480, height: 900 });
  await page.goto("/");
  const row = page.locator(".home .sections-grid");
  await expect(row.locator("> *").first()).toBeVisible();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => row.evaluate((one) => one.scrollLeft)).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // To the row's end, then on down the page.
  const end = await row.evaluate((one) => one.scrollWidth - one.clientWidth);
  for (let turn = 0; turn < Math.ceil(end / 200) + 1; turn++) await page.mouse.wheel(0, 200);
  await expect.poll(() => row.evaluate((one) => Math.round(one.scrollLeft))).toBe(end);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
