import { expect, test } from "@playwright/test";
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
