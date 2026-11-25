import { devices, expect, test } from "@playwright/test";
import { LIST_ID, list, mockBackend } from "./fixtures";
import { signIn } from "./signedIn";
import { startFromScratch } from "./listVersion";

// From 840 px the pool is a card in a column beside the board; the count and
// the buttons stand in the page's header, which stays in view while a long
// board scrolls.
test.describe("a wide screen", () => {
  test.skip(({ hasTouch }) => hasTouch, "a laptop's layout");

  // One scroll, the page's (artboard 31): the header stays under the app bar,
  // the column goes with the board, and it has no scroll bar of its own to
  // take a column of cards (a 1920 screen, 17.11).
  test("keeps the header while the page scrolls, and the pool goes with the board", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1700, height: 720 });
    await mockBackend(page);
    const tiers = Array.from({ length: 20 }, (_, i) => ({
      label: `T${i + 1}`,
      caption: null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    await page.route(`**/lists/${LIST_ID}`, (route) => route.fulfill({ json: { ...list, tiers } }));
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    await startFromScratch(page);

    await page.getByRole("button", { name: "Cards beside the tiers" }).click();
    const side = page.locator(".ranking__side");
    const board = page.locator(".board");
    const sideBox = (await side.boundingBox())!;
    const boardBox = (await board.boundingBox())!;
    expect(sideBox.x).toBeGreaterThanOrEqual(boardBox.x + boardBox.width - 1);
    await expect(page.locator(".pool__items")).toHaveCSS("display", "grid");
    await expect(page.locator(".pool__items")).toHaveCSS("overflow-y", "visible");
    // Moving the pool does not move the buttons: they are the header's.
    const head = page.locator(".list-head");
    await expect(head.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(head.getByText("0 of 3 placed")).toBeVisible();
    await expect(side.getByRole("button", { name: "Undo" })).toHaveCount(0);

    const header = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")),
    );
    const onPage = () =>
      page.evaluate(() =>
        Math.round(document.querySelector(".pool")!.getBoundingClientRect().top + window.scrollY),
      );
    const poolTop = await onPage();
    // The wheel over the column scrolls the page too: it has no scroll of its own.
    await page.mouse.move(sideBox.x + 40, sideBox.y + 120);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    // The header stays under the app bar; the column has gone up with the page:
    // where it stands on the page, measured with the scroll in one go, is unchanged.
    await expect
      .poll(async () => Math.round((await head.boundingBox())!.y))
      .toBe(Math.round(header));
    await expect.poll(onPage).toBe(poolTop);
    expect((await page.locator(".pool").boundingBox())!.y).toBeLessThan(poolTop - 300);
  });

  test("shows the author's ranking as wide as the visitor's board, beside or under", async ({
    page,
  }) => {
    await mockBackend(page);
    const tier = page.locator(".tier").first();
    for (const size of [
      { width: 1280, height: 720 }, // beside
      { width: 1600, height: 900 }, // under
    ]) {
      await page.setViewportSize(size);
      // The author's arrangement first, as the list opens, then one's own version:
      // the version the last size made is put aside, away from the page.
      if (page.url().includes("/l/")) {
        await page.evaluate((id) => localStorage.removeItem(`tyl:draft:${id}`), LIST_ID);
        await page.goto("about:blank");
      }
      await page.goto(`/l/${LIST_ID}`);
      await expect(page.getByRole("region", { name: "Their ranking" })).toBeVisible();
      const theirs = (await tier.boundingBox())!;
      await startFromScratch(page);
      await expect(page.getByRole("region", { name: "Your ranking" })).toBeVisible();
      const mine = (await tier.boundingBox())!;
      expect(Math.round(theirs.x)).toBe(Math.round(mine.x));
      expect(Math.round(theirs.width)).toBe(Math.round(mine.width));
      // Mine's first tier is empty and the author's holds a card: one height, 90 + 2 × 12.
      expect(Math.round(mine.height)).toBe(114);
      expect(Math.round(theirs.height)).toBe(114);
    }
  });

  // Somebody else's list on a wide window has its cards beside the board
  // (artboard 21); under is a choice, kept, as is the way back beside.
  test("docks the pool under the board on a wide window and remembers a choice", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await mockBackend(page);
    // Twelve tiers, so the page is taller than the window and the dock has something to stick to.
    const tiers = Array.from({ length: 12 }, (_, i) => ({
      label: `T${i + 1}`,
      caption: null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    await page.route(`**/lists/${LIST_ID}`, (route) => route.fulfill({ json: { ...list, tiers } }));
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    await startFromScratch(page);
    const board = page.locator(".ranking");
    await expect(board).not.toHaveClass(/ranking--under/);
    await page.getByRole("button", { name: "Cards under the tiers" }).click();
    await expect(board).toHaveClass(/ranking--under/);
    await expect(page.locator(".pool")).toHaveCSS("position", "fixed");
    await expect(page.locator(".list-head").getByRole("button", { name: "Undo" })).toBeVisible();
    const poolBox = (await page.locator(".pool").boundingBox())!;
    expect(Math.round(poolBox.y + poolBox.height)).toBe(900);
    // The page keeps room under the board for the dock: the footer waits, and at
    // the end of the scroll the dock is still at the foot with the last row 24 px
    // above its edge.
    await expect(page.locator(".foot")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--dock-h")))
      .toMatch(/^\d+px$/);
    // The dock's shadow says a row is underneath it; at the end of the scroll it goes.
    await expect(page.locator(".pool")).toHaveClass(/pool--over/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const endBox = (await page.locator(".pool").boundingBox())!;
    expect(Math.round(endBox.y + endBox.height)).toBe(900);
    const lastTier = (await page.locator(".tier").last().boundingBox())!;
    expect(Math.round(endBox.y - (lastTier.y + lastTier.height))).toBe(24);
    await expect(page.locator(".pool")).not.toHaveClass(/pool--over/);
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.getByRole("button", { name: "Cards beside the tiers" }).click();
    await expect(board).not.toHaveClass(/ranking--under/);
    await expect(page.locator(".ranking__side")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    // The version started from scratch is one's own: the list opens on it again.
    await expect(page.locator(".list-head__version")).toBeVisible();
    await expect(page.locator(".ranking")).not.toHaveClass(/ranking--under/);
    await page.getByRole("button", { name: "Cards under the tiers" }).click();
    await expect(page.locator(".ranking")).toHaveClass(/ranking--under/);
  });

  // Beside, the board stops at 1120 and the pool grows by whole columns of cards:
  // six at 1700, the two together in the middle, nothing left over at one side.
  // (A laptop, 1200 to 1599, has four larger cards instead: artboard 31.)
  test("widens the pool by whole columns of cards and centres the two on a wide window", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("tyl:pool-dock", JSON.stringify({ wide: { dock: "beside" } })),
    );
    await mockBackend(page);
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `Film ${i + 1}`,
      imageUrl: null,
      // The author placed one, so the page offers Mine; Mine starts with all twelve to place.
      tierIndex: i === 0 ? 0 : null,
    }));
    await page.route(`**/lists/${LIST_ID}`, (route) =>
      route.fulfill({ json: { ...list, itemCount: items.length, items } }),
    );
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    await startFromScratch(page);
    await expect(page.locator(".ranking")).not.toHaveClass(/ranking--under/);
    await page.waitForFunction(() => document.getAnimations().length === 0);

    // The grid's own columns: a card without a picture spans two of them.
    const columns = await page
      .locator(".pool__items")
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(6);
    const board = (await page.locator(".board").boundingBox())!;
    const pool = (await page.locator(".pool").boundingBox())!;
    // 2 × 16 + 6 × 64 + 5 × 10, and 24 between it and the board.
    expect(Math.round(pool.width)).toBe(466);
    expect(Math.round(pool.x - (board.x + board.width))).toBe(24);
    // No dead strip at either side: the board takes what the column leaves, the margins equal.
    expect(Math.round(board.width)).toBe(1120);
    const left = board.x;
    const right = 1700 - (pool.x + pool.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  // The /r/ page: the panel with the chips, the invitation, the link and the picture beside the board.
  test("stands the ranking's handout beside its board", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/api/rank/abcdefgh", (route) =>
      route.fulfill({
        json: {
          code: "abcdefgh",
          listId: LIST_ID,
          listAvailable: true,
          createdAt: 0,
          rows: [[1], [0]],
          snapshot: {
            title: list.title,
            authorName: list.authorName,
            authorPhotoUrl: null,
            category: list.category,
            tiers: list.tiers,
            items: list.items,
          },
        },
      }),
    );
    await page.goto("/r/abcdefgh");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    const side = page.locator(".ranking--read .ranking__side");
    const boardBox = (await page.locator(".board").first().boundingBox())!;
    const sideBox = (await side.boundingBox())!;
    expect(sideBox.x).toBeGreaterThanOrEqual(boardBox.x + boardBox.width - 1);
    // The handout's column holds no cards: 320 at any width.
    expect(Math.round(sideBox.width)).toBe(320);
    await expect(side.getByRole("link", { name: "Rank this list" })).toHaveAttribute(
      "href",
      `/l/${LIST_ID}`,
    );
    await expect(side.getByRole("button", { name: "Download image" })).toBeVisible();
    // The link is the chip in the header: a press copies it.
    await expect(
      page.locator(".list-head").getByRole("button", { name: /\/r\/abcdefgh$/ }),
    ).toBeVisible();
  });

  // The bar's search field, a laptop's way to the search page.
  test("searches from the bar", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/lists?**", (route) =>
      route.fulfill({ json: { lists: [list], nextCursor: null } }),
    );
    await page.goto("/about");
    const box = page.getByRole("banner").getByRole("searchbox", { name: "Search lists" });
    await box.fill("anime");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=anime$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("“anime”");
    await expect(box).toHaveValue("anime");
  });

  // A tablet held upright: the docked tray, cards 52 × 76 as in the rows (a name
  // without a picture as wide as a picture, night pass W3), the band 80.
  test("docks a taller tray on a tablet held upright", async ({ browser }) => {
    const tablet = await browser.newContext({ ...devices["iPad (gen 7)"] });
    const page = await tablet.newPage();
    await mockBackend(page);
    await page.goto(`/l/${LIST_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    await startFromScratch(page);

    const pool = page.locator(".pool");
    await expect(pool).toHaveCSS("position", "fixed");
    // Switching to Mine moves the cards for 200 ms; measured once they land.
    await expect
      .poll(async () => {
        const tile = (await page.getByRole("button", { name: "Ex Machina" }).boundingBox())!;
        return [Math.round(tile.width), Math.round(tile.height)];
      })
      .toEqual([52, 76]);
    const band = (await page.locator(".tier__band").first().boundingBox())!;
    expect(Math.round(band.width)).toBe(80);
    // An empty tier is as tall as one holding a card: 76 + 2 × 12.
    const empty = (await page.locator(".board > .tier").first().boundingBox())!;
    expect(Math.round(empty.height)).toBe(100);
    await expect(page.getByRole("button", { name: "Copy link" })).toBeHidden();
    await tablet.close();
  });
  // Your lists stands in Community's grid (the Designer's rule, 19.11): the
  // same column from the same edge, a list's tile and a begun list's card as
  // wide as a feed card, New list a tile in the row, Trash at the column's end.
  test("lays Your lists out in Community's grid", async ({ page }) => {
    const tiers = [
      {
        uid: "t1",
        position: 0,
        label: "S",
        caption: null,
        colorLight: "#B03A32",
        colorDark: "#F1948C",
        isPool: false,
      },
      {
        uid: "tp",
        position: 1,
        label: "Unranked",
        caption: null,
        colorLight: "#000000",
        colorDark: "#FFFFFF",
        isPool: true,
      },
    ];
    const body = (title: string) => ({
      title,
      displayMode: "WRAP",
      category: "music",
      coverImageUrl: null,
      coverImageUrls: [],
      authorName: null,
      publishedId: null,
      deletedAt: null,
      tiers,
      items: [],
    });
    await signIn(page, {
      boards: new Map(
        [1, 2].map((n) => [
          `k${n}`,
          {
            uid: `k${n}`,
            revision: 1,
            title: `List ${n}`,
            deleted: false,
            body: body(`List ${n}`),
          },
        ]),
      ),
      started: new Map([
        [
          "got",
          {
            listId: "got",
            updatedAt: 5,
            changedAt: Date.now() - 60_000,
            listVersion: 7,
            itemCount: 45,
            tierCount: 5,
            title: "Game of Thrones characters",
            picture: null,
            pictures: [],
            category: "film_tv",
            rows: [[3, 7], [1], [], [12], []],
            placed: 4,
          },
        ],
      ]),
    });
    const feed = Array.from({ length: 8 }, (_, n) => ({
      id: `wide${n}`,
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
    }));
    await page.route("**/lists?**", (route) =>
      route.fulfill({ json: { lists: feed, nextCursor: null } }),
    );
    for (const width of [1280, 2000]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const card = page.locator(".home .feed > li").first();
      await expect(card).toBeVisible();
      const home = (await page.locator(".home").boundingBox())!;
      const feedCard = (await card.boundingBox())!;

      await page.goto("/b");
      const tiles = page.locator(".boards__grid > li");
      await expect(tiles).toHaveCount(3);
      const column = (await page.locator(".boards").boundingBox())!;
      expect(Math.round(column.x)).toBe(Math.round(home.x));
      expect(Math.round(column.width)).toBe(Math.round(home.width));
      const boxes = await tiles.evaluateAll((all) =>
        all.map((one) => {
          const r = one.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
        }),
      );
      const first = boxes[0]!;
      // Two lists and New list in one row from the column's start, as wide as the feed's cards.
      expect(first.x).toBe(Math.round(home.x));
      for (const one of boxes) {
        expect(Math.abs(one.w - feedCard.width)).toBeLessThanOrEqual(1);
        expect(one.y).toBe(first.y);
      }
      const begun = (await page.locator(".started__list > li").first().boundingBox())!;
      expect(Math.abs(begun.width - feedCard.width)).toBeLessThanOrEqual(1);
      const trash = (await page.locator(".boards__actions").boundingBox())!;
      expect(Math.round(trash.x + trash.width)).toBe(Math.round(home.x + home.width));
    }
  });

  // Danylo's 2560 walk (25.11): the home was 2200 wide, a section and search a
  // 1020 column and a list's board 1120, under a bar whose logo and buttons
  // stood at the window's edges. Every page now keeps to one column, 1760 at
  // most (--width-page), and the bar's logo and buttons stand on its edges.
  test("keeps every page to one column, the bar's logo and buttons on its edges", async ({
    page,
  }) => {
    await mockBackend(page);
    const feed = Array.from({ length: 8 }, (_, n) => ({
      id: `col${n}`,
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
    }));
    await page.route("**/lists?**", (route) =>
      route.fulfill({ json: { lists: feed, nextCursor: null } }),
    );
    const edges = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      return { left: box.x, right: box.x + box.width };
    };
    for (const width of [1280, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      const column = Math.min(width - 64, 1760);
      const pages: [string, string, string][] = [
        ["/", ".home", ".home .feed > li"],
        ["/s/film_tv", ".section-page", ".section-head"],
        ["/search?q=film", ".search", ".search .list-card"],
      ];
      for (const [path, selector, ready] of pages) {
        await page.goto(path);
        await expect(page.locator(ready).first()).toBeVisible();
        const content = await edges(selector);
        const brand = await edges(".top .brand");
        const actions = await edges(".top__actions");
        expect(Math.round(content.right - content.left), `${path} at ${width}`).toBe(column);
        expect(Math.abs(brand.left - content.left), `${path} at ${width}`).toBeLessThanOrEqual(1);
        expect(Math.abs(actions.right - content.right), `${path} at ${width}`).toBeLessThanOrEqual(
          1,
        );
      }
      // Somebody's list: the board, with its cards beside it or under it,
      // from the column's one edge to the other.
      await page.goto(`/l/${LIST_ID}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
      const brand = await edges(".top .brand");
      const actions = await edges(".top__actions");
      const board = await edges(".board");
      const side = page.locator(".ranking:not(.ranking--under) .ranking__side");
      const end = (await side.count()) > 0 ? (await edges(".ranking__side")).right : board.right;
      expect(Math.abs(board.left - brand.left), `list at ${width}`).toBeLessThanOrEqual(2);
      expect(Math.abs(end - actions.right), `list at ${width}`).toBeLessThanOrEqual(2);
    }
  });
});
