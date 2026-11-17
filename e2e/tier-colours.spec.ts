import { expect, test } from "@playwright/test";
import { LIST_ID, mockBackend } from "./fixtures";

/** The first tier's band, as the list's page paints it. */
const bandOf = (page: import("@playwright/test").Page) =>
  page
    .locator(".tier__band")
    .first()
    .evaluate((band) => {
      const style = getComputedStyle(band);
      return { background: style.backgroundColor, letter: style.color };
    });

// Artboard 17: each scheme wears its own colour of a tier, as the app and the
// tier editor's Dark preview do. S is #b03a32 light and #f1948c dark.
test("a tier wears its light colour with a white letter, and its dark one with a dark letter", async ({
  page,
}) => {
  await mockBackend(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/l/${LIST_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
  expect(await bandOf(page)).toEqual({
    background: "rgb(176, 58, 50)",
    letter: "rgb(255, 255, 255)",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => bandOf(page))
    .toEqual({
      background: "rgb(241, 148, 140)",
      letter: "rgb(18, 19, 24)",
    });
});
