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
  // A poster's shape, two wide for three high, while a tile's copy is checked.
  let poster = false;
  const POSTER = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"></svg>';
  await page.route("**/img/**", (route) => {
    shown.push(new URL(route.request().url()).pathname);
    return poster
      ? route.fulfill({ contentType: "image/svg+xml", body: POSTER })
      : route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await page.route(
    (url) => url.pathname.endsWith("/lists"),
    (route) => route.fulfill({ json: { lists: [illustrated], nextCursor: null } }),
  );
  await page.route("**/lists/abc", (route) => route.fulfill({ json: illustrated }));
  // A list opened first: a tile asks for the card's smallest copy that covers
  // it on this screen, never the 600 × 900 original (Designer, 25.11): the
  // width a poster needs to cover the tile it has on this window, times the
  // screen's density (Danylo, 28.11), and no other copy after it.
  poster = true;
  await page.goto("/l/abc");
  const first = page.getByRole("button", { name: "Ex Machina", exact: true }).locator("img");
  await expect
    .poll(() => first.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  const { needed, density } = await first.evaluate((img: HTMLImageElement) => {
    const box = img.getBoundingClientRect();
    return {
      needed: Math.ceil(Math.max(box.width, (box.height * 2) / 3)),
      density: window.devicePixelRatio,
    };
  });
  await expect(first).toHaveAttribute("sizes", `${needed}px`);
  const copy = [200, 400, 800].find((w) => w >= needed * density) ?? "original";
  expect(new URL(await first.evaluate((img: HTMLImageElement) => img.currentSrc)).pathname).toBe(
    `/img/${copy}/${photo}`,
  );
  expect(shown.filter((one) => one.endsWith(photo))).toEqual([`/img/${copy}/${photo}`]);
  poster = false;
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
  await expect.poll(() => tile.getAttribute("srcset")).toContain(`/img/200/${photo}?v=3 200w, `);
  expect(direct).toEqual([]);
});
