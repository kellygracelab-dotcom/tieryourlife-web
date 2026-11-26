import { expect, test, type Locator } from "@playwright/test";
import { signIn } from "./signedIn";

const section = (id: string, name: string, rank: number) => ({
  id,
  name,
  rank,
  builtIn: true,
  status: "approved",
  listCount: 0,
  followerCount: 0,
  collage: [],
});

const SECTIONS = [
  section("film_tv", "Film & TV", 1),
  section("anime", "Anime", 2),
  section("games", "Games", 3),
  section("music", "Music", 4),
  section("other", "Other", 9),
];

test.describe("the owner's section order", () => {
  test.skip(({ hasTouch }) => hasTouch, "a mouse drag; a finger drags by the handle");

  // A row is taken by its name, not only by the small handle, and follows the
  // pointer: it sits under the pointer while held, and its place is saved.
  test("drags a row by any part of it to the top and saves the order", async ({ page }) => {
    await signIn(page);
    const saves: unknown[] = [];
    await page.route(
      (url) =>
        url.pathname.endsWith("/lists/sections") || url.pathname.endsWith("/lists/sections/order"),
      async (route) => {
        const request = route.request();
        if (request.method() === "PUT") {
          saves.push(request.postDataJSON());
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"version":2}',
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sections: SECTIONS, role: "owner", version: 1 }),
        });
      },
    );
    await page.goto("/admin/sections");

    const names = page.locator(".admin-order__name");
    await expect(names).toHaveText(["Film & TV", "Anime", "Games", "Music", "Other"]);
    const music = page.locator(".admin-order__row", { hasText: "Music" });
    const from = await names.nth(3).boundingBox();
    const top = await page.locator(".admin-order__row").first().boundingBox();
    if (from === null || top === null) throw new Error("no rows");

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      const y = from.y + from.height / 2 + ((top.y + 4 - from.y - from.height / 2) * step) / 12;
      await page.mouse.move(from.x + from.width / 2, y);
    }
    // Held, the row is under the pointer, not left in a slot of its own.
    const held = await music.boundingBox();
    expect(held?.y ?? Infinity).toBeLessThanOrEqual(top.y + 1);
    await page.mouse.up();

    await expect(names).toHaveText(["Music", "Film & TV", "Anime", "Games", "Other"]);
    await expect(music).not.toHaveAttribute("style", /translate/);
    await page
      .getByRole("region", { name: "Unsaved changes" })
      .getByRole("button", { name: "Save" })
      .click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toMatchObject({ ids: ["music", "film_tv", "anime", "games", "other"] });
  });
});

/** A 16:10 picture whose bottom-left is where its topic was focused. */
const WIDE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#e0b84a"/><rect y="80" width="40" height="20" fill="#111111"/></svg>';

/** The part of its picture a placed picture shows, as fractions of the picture, from its style. */
const shownPart = (picture: Locator) =>
  picture.evaluate((element: HTMLElement) => {
    const { left, top, width, height } = element.style;
    const across = parseFloat(width) / 100;
    const down = parseFloat(height) / 100;
    return {
      left: -parseFloat(left) / 100 / across,
      top: -parseFloat(top) / 100 / down,
      width: 1 / across,
      height: 1 / down,
    };
  });

// A topic's picture is cut by its focus for the shape it shows in. Staff saw
// it in a square, which shows the whole height of a wide picture whatever the
// focus says, while the site's low tile showed only the dark corner the focus
// sat on (Marketing, the Star Wars topic, 26.11): staff now see the tile's cut.
test("staff see a topic's picture cut as its tile on the site cuts it", async ({ page }) => {
  await signIn(page);
  const film = {
    ...section("film_tv", "Film & TV", 1),
    listCount: 3,
    newThisWeek: 0,
    following: false,
  };
  await page.route("**/lists/sections", (route) =>
    route.fulfill({ json: { sections: [film], role: "owner", version: 1 } }),
  );
  const topic = {
    id: "sw",
    name: "Star Wars",
    section: "film_tv",
    status: "approved",
    listCount: 3,
    followerCount: 5,
    following: false,
    mergedInto: null,
    pictureUrl: "https://pictures.test/star-wars.svg",
    pictureFocus: { x: 0.1, y: 0.95, zoom: 1 },
  };
  await page.route("**/lists/topics?**", (route) =>
    route.fulfill({ json: { topics: [topic], nextCursor: null } }),
  );
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [], nextCursor: null } }),
  );
  await page.route("https://pictures.test/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: WIDE }),
  );

  await page.goto("/s/film_tv");
  const onTile = page.locator(".topic-tile__picture img");
  await expect(onTile).toHaveAttribute("style", /height/);
  const tile = await shownPart(onTile);
  // The tile shows the bottom strip of the picture, where the focus is.
  expect(tile.top + tile.height).toBeCloseTo(1, 2);
  expect(tile.height).toBeLessThan(0.7);

  await page.goto("/admin/topics");
  const row = page.locator(".admin-topics__row", { hasText: "Star Wars" });
  const thumb = row.locator(".admin-topics__tile");
  const box = await thumb.boundingBox();
  if (box === null) throw new Error("no tile");
  expect(box.width / box.height).toBeCloseTo(3, 1);
  const inAdmin = row.locator(".admin-topics__tile img");
  await expect(inAdmin).toHaveAttribute("style", /height/);
  const staff = await shownPart(inAdmin);
  for (const side of ["left", "top", "width", "height"] as const) {
    expect(Math.abs(staff[side] - tile[side])).toBeLessThan(0.07);
  }
});

// New lists wait for staff before the feed (Danylo, 26.11.2026): their queue
// is the first pane, the longest waiting first; Approve lets one in.
test("staff approve a new list waiting before the feed from the first pane", async ({ page }) => {
  await signIn(page);
  const approved: string[] = [];
  const day = 24 * 60 * 60 * 1000;
  const waiting = (id: string, title: string, days: number) => ({
    id,
    title,
    authorUid: "u2",
    authorName: "Fern",
    authorPhotoUrl: null,
    category: "film_tv",
    itemCount: 7,
    coverImageUrl: null,
    previewImages: [],
    tierColors: ["#ff7f7f"],
    updatedAt: Date.now() - days * day,
    takeCount: 0,
    publishedAt: Date.now() - days * day,
    underReview: false,
    publishedBy: { uid: "u2", name: "Fern" },
  });
  await page.route("**/lists/sections", (route) =>
    route.fulfill({ json: { sections: SECTIONS, role: "moderator", version: 1 } }),
  );
  await page.route("**/lists/admin/approvals", (route) =>
    route.fulfill({
      json: {
        lists: [waiting("L-old", "Ramen in Lviv", 3.5), waiting("L-new", "Frieren cast", 0)],
      },
    }),
  );
  await page.route("**/lists/*/approve", (route) => {
    approved.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/admin/approvals");
  await expect(page.getByRole("heading", { level: 2, name: "Awaiting approval" })).toBeVisible();
  const cards = page.getByRole("list", { name: "Awaiting approval" }).getByRole("listitem");
  await expect(cards.getByRole("heading", { level: 3 })).toHaveText([
    "Ramen in Lviv",
    "Frieren cast",
  ]);
  await expect(cards.first()).toContainText("Published 3 days ago");
  await cards.first().getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".snackbar")).toContainText("Approved. It’s in the feed now.");
  await expect(cards).toHaveCount(1);
  expect(approved).toEqual(["/lists/L-old/approve"]);
});
