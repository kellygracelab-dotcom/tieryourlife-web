import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";
import { PIXEL } from "./signedIn";

test("reads older published photo URLs through Hosting when direct Storage reads are refused", async ({
  page,
}) => {
  await mockBackend(page);
  const bucket = "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/";
  const stored = (path: string) => bucket + encodeURIComponent(path) + "?alt=media";
  const photo = "published/abc/photo1";
  const avatar = "avatars/author/face1";
  const illustrated = {
    ...list,
    coverImageUrl: stored(photo),
    authorPhotoUrl: stored(avatar),
    items: list.items.map((item) => ({ ...item, imageUrl: stored(photo) })),
  };
  const direct: string[] = [];
  await page.route(bucket + "**", (route) => {
    direct.push(route.request().url());
    return route.fulfill({ status: 401 });
  });
  const shown: string[] = [];
  await page.route("**/img/**", (route) => {
    shown.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await page.route(
    (url) => url.pathname.endsWith("/lists"),
    (route) => route.fulfill({ json: { lists: [illustrated], nextCursor: null } }),
  );
  await page.route("**/lists/abc", (route) => route.fulfill({ json: illustrated }));
  await page.goto("/");
  const entry = page.locator('.list-card__main[href="/l/abc"]').first();
  const cover = entry.locator("img").first();
  await expect(cover).toHaveAttribute("src", "/img/original/" + photo);
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  const face = page.locator(".list-card img.list-card__face").first();
  await expect(face).toHaveAttribute("src", "/img/original/" + avatar);
  await entry.click();
  const tile = page.getByRole("button", { name: "Ex Machina", exact: true }).locator("img");
  // A tile asks for the card's small copy, never the 600 × 900 original (Designer, 25.11).
  await expect(tile).toHaveAttribute("src", "/img/200/" + photo);
  await expect
    .poll(() => tile.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(direct).toEqual([]);
  expect(shown).toContain("/img/200/" + photo);
});
