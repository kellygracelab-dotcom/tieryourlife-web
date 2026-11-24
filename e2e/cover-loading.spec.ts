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

// Your lists glues a board's mosaic into one picture once its pictures have
// come, keeps it in this browser only, and shows it alone the next time
// (cover-collage BRIEF, steps 2 and 3, 24.11.2026).
test("a board's collage is glued on this device and shown alone the next time", async ({
  page,
}) => {
  await mockBackend(page);
  const asked: string[] = [];
  await page.route("https://pics.test/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: PIXEL,
    });
  });
  const sent: string[] = [];
  page.on("request", (request) => {
    const type = request.headers()["content-type"] ?? "";
    const body = request.postDataBuffer();
    if (type.startsWith("image/") || (body !== null && body.length > 4096))
      sent.push(request.url());
  });
  const uid = "glued-pictures";
  const boardOf = (urls: readonly string[]) => ({
    uid,
    title: "Glued pictures",
    tiers: ["S", "Pool"].map((label, i) => ({ uid: label, label, isPool: i === 1, position: i })),
    items: urls.map((imageUrl, i) => ({
      uid: "c" + i,
      title: "Card " + i,
      imageUrl,
      tierUid: "S",
      position: i,
      deletedAt: null,
    })),
  });
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    },
    { key: "tyl:board:" + uid, value: boardOf(pictures("g")) },
  );
  // What this browser keeps: the keys of the site's own database.
  const kept = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((done, failed) => {
          const opened = indexedDB.open("tyl-glued");
          opened.onerror = () => failed(opened.error);
          opened.onsuccess = () => {
            const database = opened.result;
            if (!database.objectStoreNames.contains("pictures")) return done([]);
            const keys = database.transaction("pictures").objectStore("pictures").getAllKeys();
            keys.onsuccess = () => done(keys.result.map(String));
            keys.onerror = () => failed(keys.error);
          };
        }),
    );

  // The first time: the mosaic, its six pictures, then one glued picture kept.
  await page.goto("/b");
  const tile = page.locator(".board-tile .art").first();
  await expect(tile.locator(".art__shown")).toHaveCount(6);
  await expect.poll(kept).toHaveLength(1);
  const first = (await kept())[0]!;
  expect(first).toMatch(/^-\/glued-pictures\/\d+x\d+\/[a-z0-9]+$/);

  // The next time: the one picture from this browser, none of the six asked for.
  asked.length = 0;
  await page.reload();
  await expect(tile).toHaveClass(/art--collage/);
  await expect(tile.locator("img")).toHaveCount(1);
  expect(await tile.locator("img").getAttribute("src")).toMatch(/^blob:/);
  await expect(tile).not.toHaveClass(/art--waiting/);
  expect(asked).toEqual([]);

  // The first cards changed: drawn again from the mosaic, the old one gone.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: "tyl:board:" + uid,
    value: boardOf([...pictures("g")].reverse()),
  });
  await page.reload();
  await expect(tile).toHaveClass(/art--mosaic/);
  await expect(tile.locator(".art__shown")).toHaveCount(6);
  await expect.poll(kept).not.toEqual([first]);
  expect(await kept()).toHaveLength(1);

  // Never sent anywhere.
  expect(sent).toEqual([]);
});
