import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";

// The site on a phone, as Danylo approved it on 25.11.2026 (as the app has
// it): Community and Your lists under one bar of 56 px with the tabs in it,
// New list the round button at the lower corner, the bar away while the page
// scrolls down; Settings with a row each for the theme, the colour and the
// language; the foot in two lines. A computer keeps its own layout.
test.beforeEach(({ page }) => {
  test.skip(page.viewportSize()!.width >= 600, "the phone's layout");
});

const scrollTo = (page: Page, y: number) => page.evaluate((to) => window.scrollTo(0, to), y);

test("Community and Your lists have one bar of 56 px, with the tabs in it", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  const bar = page.getByRole("banner");
  const tabs = bar.getByRole("navigation", { name: "Site" });
  await expect(tabs.getByRole("link", { name: "Community" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: "Your lists" })).toBeVisible();
  expect((await bar.boundingBox())!.height).toBe(56);
  // The search and the account sit at the bar's end; the brand is its icon alone.
  await expect(bar.getByRole("link", { name: "Search lists" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "TierYourLife" })).toBeVisible();
  await expect(bar.getByText("TierYourLife", { exact: true })).toHaveCSS("width", "1px");
  // Nothing else in a row of its own under it.
  expect(await page.locator("nav[aria-label='Site']").count()).toBe(1);
  // Every part of the bar inside the window, in English and on a narrow phone too.
  const width = page.viewportSize()!.width;
  const ends = await bar
    .locator("a, button, summary")
    .evaluateAll((all) =>
      all
        .filter((one) => one.getBoundingClientRect().width > 1)
        .map((one) => one.getBoundingClientRect().right),
    );
  for (const end of ends) expect(end).toBeLessThanOrEqual(width);

  await tabs.getByRole("link", { name: "Your lists" }).click();
  await expect(page).toHaveURL("/b");
  await expect(tabs.getByRole("link", { name: "Your lists" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect((await bar.boundingBox())!.height).toBe(56);
});

test("New list is the round button at the lower corner, and makes a list", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/b");
  const fab = page.locator(".fab");
  await expect(fab).toHaveAccessibleName("New list");
  // The bar's own is not there on a phone.
  await expect(page.locator(".top__make")).toBeHidden();
  const box = (await fab.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.width).toBe(56);
  expect(box.height).toBe(56);
  expect(Math.round(view.width - (box.x + box.width))).toBe(16);
  expect(Math.round(view.height - (box.y + box.height))).toBeGreaterThanOrEqual(16);
  await fab.click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.locator(".fab")).toHaveCount(0);
});

test("the bar goes up as the page scrolls down, and comes back as it scrolls up", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
  });
  const bar = page.getByRole("banner");
  await scrollTo(page, 600);
  await expect(bar).toHaveClass(/top--away/);
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThanOrEqual(-56);
  await scrollTo(page, 400);
  await expect(bar).not.toHaveClass(/top--away/);
  await expect.poll(async () => (await bar.boundingBox())!.y).toBe(0);
  // The round button stays.
  await expect(page.locator(".fab")).toBeInViewport();
});

test("the bar does not slide for someone who asked for less motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockBackend(page);
  await page.goto("/");
  await expect(page.getByRole("banner")).toHaveCSS("transition-duration", "0s");
});

test("Settings has a row each for the theme, the colour and the language, each opening a sheet", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto("/settings");
  await expect(page.getByText("Sign in to change your settings.")).toBeVisible();
  // Sign in is the first card, one row high beside the person.
  const first = page.locator(".settings__card").first();
  await expect(first).toContainText("Sign in to change your settings.");
  expect((await first.boundingBox())!.height).toBeLessThan(200);
  // No list of eleven languages on the page itself.
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  const theme = page.getByRole("button", { name: "Theme" });
  await expect(theme).toContainText("System");
  await expect(page.getByRole("button", { name: "Colour" })).toContainText("Lavender");
  await expect(page.getByRole("button", { name: "Language" })).toContainText("English");

  await theme.click();
  const sheet = page.getByRole("dialog", { name: "Theme" });
  await expect(sheet).toBeVisible();
  // From the window's lower edge, the window's width.
  await expect
    .poll(async () => {
      const box = (await sheet.boundingBox())!;
      return Math.round(box.y + box.height);
    })
    .toBe(page.viewportSize()!.height);
  await sheet.getByRole("radio", { name: "Dark" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme).toContainText("Dark");

  await page.getByRole("button", { name: "Language" }).click();
  const languages = page.getByRole("dialog", { name: "Language" });
  await expect(languages.getByRole("radio", { name: "English" })).toBeChecked();
  await languages.getByRole("button", { name: "Done" }).click();
  await expect(languages).toBeHidden();
});

test("the foot is two lines: the links, and the app's words in grey under them", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto("/settings");
  const foot = page.getByRole("contentinfo");
  const links = foot.getByRole("link");
  await expect(links).toHaveText(["Privacy", "About", "Settings"]);
  const tops = await links.evaluateAll((all) =>
    all.map((one) => Math.round(one.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  // An iPhone is told nothing of an Android app.
  const apple = await page.evaluate(() => /iPhone|iPad|iPod/.test(navigator.userAgent));
  const app = foot.getByText("Android app — coming soon to Google Play");
  if (apple) {
    await expect(app).toHaveCount(0);
    return;
  }
  await expect(app).toBeVisible();
  expect((await app.boundingBox())!.y).toBeGreaterThan(tops[0]! + 10);
  // Words, not a link: grey, and nothing to press.
  expect(await app.evaluate((one) => one.closest("a"))).toBeNull();
});
