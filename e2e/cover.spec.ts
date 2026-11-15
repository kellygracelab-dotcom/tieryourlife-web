import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";
import { shot } from "./signedIn";

/*
 * Adjust cover (_coordination/cover-focus-2026-11-15/SPEC.md, second round):
 * the point a cover of one picture is looked at moves anywhere on the whole
 * picture, Done keeps it, and every tile that shows the cover cuts it there
 * by the shared formula.
 */

const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

// A portrait whose head is at the top: 400 × 800, the top fifth red.
const PORTRAIT = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800">',
  '<rect width="400" height="800" fill="#2d6a4f"/>',
  '<rect width="400" height="160" fill="#d62828"/>',
  '<circle cx="200" cy="80" r="56" fill="#f4d35e"/>',
  "</svg>",
].join("");

async function boardWithPortrait(page: Page, touch: boolean) {
  await mockBackend(page);
  await page.route("**/lists/pictures?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "tmdb:p0",
            title: "Portrait",
            imageUrl: "https://img.test/portrait.svg",
            thumbUrl: null,
            source: "tmdb",
            kind: "movie",
          },
        ],
        hasMore: false,
        notices: [],
      },
    }),
  );
  await page.route("https://img.test/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: PORTRAIT }),
  );
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Portraits");
  await title.press("Enter");
  if (touch) await press(page.getByRole("button", { name: "Add", exact: true }), touch);
  await page.getByRole("textbox", { name: "Add a card" }).fill("Portrait");
  await press(page.getByRole("button", { name: "Portrait Film" }), touch);
  await expect(page.getByRole("button", { name: "Portrait", exact: true })).toBeVisible();
}

/** Where the picture's top edge is drawn, as a share of its own box. */
const topOf = (picture: Locator) => picture.evaluate((img) => (img as HTMLImageElement).style.top);

test("adjusts a cover of one picture, and its tile shows the place kept", async ({
  page,
  hasTouch,
}) => {
  await boardWithPortrait(page, hasTouch);
  await page.getByLabel("More about this board").click();
  await page.getByRole("button", { name: "List settings" }).click();
  await press(page.getByRole("button", { name: /Cover/ }), hasTouch);
  await press(page.getByRole("button", { name: "Use Portrait on the cover" }), hasTouch);
  await press(page.getByRole("button", { name: "Adjust position" }), hasTouch);

  const dialog = page.getByRole("dialog", { name: "Adjust cover" });
  await expect(dialog).toBeVisible();
  const frame = dialog.getByRole("application", { name: /The picture/ });
  await expect(frame).toBeFocused();
  // The whole picture, in its own shape, inside the window; the previews and the buttons under it.
  const box = (await frame.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(400 / 800, 1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled();
  await shot(page, `cover-adjust-${hasTouch ? "phone" : "desktop"}`);

  // A tall picture starts at its default, y 0.35; one long step up is y 0.25,
  // 200 px down the 800 px portrait. A 16:10 frame around it, 250 high,
  // starts 75 px down: drawn 30% of its height above the box.
  await frame.press("Shift+ArrowUp");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  const preview = page.locator(".board-settings__cover-frame img");
  await expect.poll(() => topOf(preview)).toBe("-30%");

  await page.emulateMedia({ colorScheme: "dark" });
  await press(page.getByRole("button", { name: "Adjust position" }), hasTouch);
  await expect(dialog).toBeVisible();
  await shot(page, `cover-adjust-${hasTouch ? "phone" : "desktop"}-dark`);
  // ✕ leaves it as it was.
  await press(dialog.getByRole("button", { name: "Cancel" }), hasTouch);
  await expect(dialog).toBeHidden();
  await expect.poll(() => topOf(preview)).toBe("-30%");
  await page.emulateMedia({ colorScheme: "light" });

  // The board's own tile on My boards, whatever its shape, is cut around the
  // same point by the shared formula: a frame as wide as the portrait,
  // 400 / A high, its middle 200 px down unless that runs over the top.
  await page.getByRole("button", { name: "Done" }).click();
  await page.goto("/b");
  const tile = page.locator(".art--cover img").first();
  await expect.poll(() => topOf(tile)).not.toBe("");
  const { aspect, top } = await tile.evaluate((img) => {
    const shape = img.parentElement!.getBoundingClientRect();
    return {
      aspect: shape.width / shape.height,
      top: parseFloat((img as HTMLImageElement).style.top),
    };
  });
  const high = 400 / aspect;
  expect(top).toBeCloseTo((-Math.max(0, 200 - high / 2) / high) * 100, 2);
  await shot(page, `cover-tile-${hasTouch ? "phone" : "desktop"}`);
});
