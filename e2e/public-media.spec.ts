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
  // A list opened first: a tile asks for the card's smallest copy that covers
  // it on this screen, never the 600 × 900 original (Designer, 25.11). Its
  // 124-pixel height is 200 pixels on a plain screen, 400 on a sharp one and
  // 800 on a sharper one (Danylo, 28.11).
  await page.goto("/l/abc");
  const first = page.getByRole("button", { name: "Ex Machina", exact: true }).locator("img");
  await expect(first).toHaveAttribute("sizes", "124px");
  const density = await page.evaluate(() => window.devicePixelRatio);
  const copy = 124 * density <= 200 ? 200 : 124 * density <= 400 ? 400 : 800;
  await expect
    .poll(() => first.evaluate((img: HTMLImageElement) => img.complete && img.currentSrc))
    .toMatch(new RegExp(`/img/${copy}/${photo}$`));
  expect(shown).toContain(`/img/${copy}/${photo}`);
  expect(shown).not.toContain(`/img/original/${photo}`);
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
  // A picture already in the browser's cache serves any size, so here only
  // the copies the tile offers are checked.
  await expect(tile).toHaveAttribute("srcset", new RegExp(`^/img/200/${photo} 200w, `));
  expect(direct).toEqual([]);
});
