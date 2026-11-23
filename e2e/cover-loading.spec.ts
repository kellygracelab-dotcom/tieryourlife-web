import { expect, test, type Locator, type Page } from "@playwright/test";
import { gate, list, mockBackend } from "./fixtures";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const pictures = (prefix: string) =>
  Array.from({ length: 6 }, (_, n) => `https://pics.test/${prefix}${n}.png`);

/** Every picture of pics.test held until the test lets them come, the last one failing. */
async function slowPictures(page: Page) {
  const held = gate();
  await page.route("https://pics.test/**", async (route) => {
    await held.promise;
    return route.request().url().endsWith("5.png")
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  return held;
}

/** The tile while its pictures are on their way, then once they came. */
async function waitsThenShows(art: Locator, release: () => void) {
  await expect(art).toHaveClass(/art--waiting/);
  const looks = await art.evaluate((tile) => {
    const after = getComputedStyle(tile, "::after");
    return {
      shimmer: after.animationName,
      shown: Array.from(tile.querySelectorAll("img"), (img) => getComputedStyle(img).opacity),
      cells: Array.from(tile.querySelectorAll(".art__cell"), (cell) => {
        const style = getComputedStyle(cell);
        return `${style.backgroundColor} ${style.outlineStyle} ${style.borderStyle}`;
      }),
    };
  });
  expect(looks.shimmer).toBe("art-shimmer");
  expect(looks.shown).toEqual(Array(6).fill("0"));
  expect(new Set(looks.cells)).toEqual(new Set(["rgba(0, 0, 0, 0) none none"]));
  release();
  await expect(art.locator(".art__shown")).toHaveCount(5);
  await expect(art).not.toHaveClass(/art--waiting/);
  // The failed one stays the tile's surface; the others fade in.
  await expect
    .poll(() =>
      art.evaluate((tile) =>
        Array.from(tile.querySelectorAll("img"), (img) => getComputedStyle(img).opacity),
      ),
    )
    .toEqual(["1", "1", "1", "1", "1", "0"]);
  await expect(art).toHaveAttribute("data-count", "6");
}

// A cover whose pictures are on their way is one quiet surface with one soft
// shimmer, no grey frames that read as broken pictures (the Designer, 23.11).
test("a Community card's collage waits as one surface and shows its pictures as they come", async ({
  page,
}) => {
  await mockBackend(page);
  const held = await slowPictures(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({
      json: {
        lists: [{ ...list, coverImageUrl: null, previewImages: pictures("c") }],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/");
  await waitsThenShows(page.locator(".home .feed .art--mosaic").first(), held.resolve);
});

test("a board's collage in Your lists does the same", async ({ page }) => {
  await mockBackend(page);
  const held = await slowPictures(page);
  const uid = "slow-pictures";
  const board = {
    uid,
    title: "Slow pictures",
    tiers: ["S", "Pool"].map((label, i) => ({ uid: label, label, isPool: i === 1, position: i })),
    items: pictures("b").map((imageUrl, i) => ({
      uid: "c" + i,
      title: "Card " + i,
      imageUrl,
      tierUid: "S",
      position: i,
      deletedAt: null,
    })),
  };
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    },
    { key: "tyl:board:" + uid, value: board },
  );
  await page.goto("/b");
  await waitsThenShows(page.locator(".board-tile .art--mosaic").first(), held.resolve);
});

test("no shimmer for someone who asked for less motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockBackend(page);
  await slowPictures(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({
      json: {
        lists: [{ ...list, coverImageUrl: null, previewImages: pictures("r") }],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/");
  const art = page.locator(".home .feed .art--mosaic").first();
  await expect(art).toHaveClass(/art--waiting/);
  expect(await art.evaluate((tile) => getComputedStyle(tile, "::after").display)).toBe("none");
});
