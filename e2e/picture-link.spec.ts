import { expect, test, type Locator } from "@playwright/test";
import { PIXEL, signIn } from "./signedIn";

/*
 * A card from a picture's link (docs/design-spec-picture-link.md, 1): the
 * link pasted in the add field opens a draft card, the backend's answer fills
 * its picture, a name is typed, and Add card puts it first in the pool.
 */

const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

const PICTURE = "https://img.test/dune.jpg";

test("makes a card from a picture's link: draft, name, Add card", async ({ page, hasTouch }) => {
  await signIn(page);
  const asked: unknown[] = [];
  await page.route("**/lists/pictures/link", (route) => {
    asked.push(route.request().postDataJSON());
    // A catalogue's own address: kept as it is, no copy to read back.
    return route.fulfill({
      json: {
        imageUrl: PICTURE,
        attribution: {
          source: "tmdb",
          id: "tmdb:movie:438631",
          link: "https://www.themoviedb.org/movie/438631",
        },
        quota: { left: 49, limit: 50, resetsAt: Date.now() + 3_600_000 },
      },
    });
  });
  await page.route("https://img.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );

  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Films with sand");
  await title.press("Enter");
  if (hasTouch) await press(page.getByRole("button", { name: "Add", exact: true }), hasTouch);

  await page.getByRole("textbox", { name: "Add a card" }).fill(PICTURE);
  const draft = page.getByRole("group", { name: "Picture from a link" });
  await expect(draft).toBeVisible();
  await expect(draft.getByRole("button", { name: "Add card" })).toBeDisabled();
  await expect(draft.locator("img")).toHaveAttribute("src", PICTURE);
  expect(asked).toEqual([{ url: PICTURE }]);

  const name = draft.getByRole("textbox", { name: "Name" });
  await name.fill("Dune");
  if (!hasTouch) {
    await expect(draft.getByRole("textbox", { name: "Page it’s from" })).toBeVisible();
  }
  await press(draft.getByRole("button", { name: "Add card" }), hasTouch);

  await expect(draft).toBeHidden();
  const card = page.getByRole("button", { name: "Dune", exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByText("Added “Dune”")).toBeVisible();
  // The card is the catalogue's picture, at its address.
  await expect(card.locator("img")).toHaveAttribute("src", /img\.test\/dune\.jpg/);
});
