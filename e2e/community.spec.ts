import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

const summary = {
  id: list.id,
  title: list.title,
  authorUid: list.authorUid,
  authorName: list.authorName,
  authorPhotoUrl: null,
  category: list.category,
  itemCount: list.itemCount,
  coverImageUrl: null,
  previewImages: [],
  tierColors: list.tierColors,
  updatedAt: list.updatedAt,
  takeCount: list.takeCount,
};

test("hides a list from its menu, with a way back in the snackbar and on the page", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);

  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Hide this list" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Whose arrangement to show" })).toBeHidden();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("group", { name: "Whose arrangement to show" })).toBeVisible();

  // Hidden for good this time: the page says so after a reload too.
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Hide this list" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
  await page.getByRole("button", { name: "Unhide" }).click();
  await expect(page.getByRole("group", { name: "Whose arrangement to show" })).toBeVisible();
});

test("asks a guest to sign in before reporting, and offers to hide instead", async ({ page }) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Report this list" }).click();
  const ask = page.getByRole("dialog", { name: "Sign in to report" });
  await expect(ask).toContainText("Reports go to a person");
  await ask.getByRole("button", { name: "Hide instead" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "You hid this list" })).toBeVisible();
});

test("a guest's settings: the theme on this device, and the privacy policy", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/settings");
  await expect(page.getByText("Sign in to change your settings.")).toBeVisible();
  await page.getByRole("radio", { name: "Dark" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(19, 19, 24)");
  await expect(page.getByRole("link", { name: /Privacy policy/ }).first()).toHaveAttribute(
    "href",
    "/privacy.html",
  );
  await page.getByRole("radio", { name: "System" }).first().click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

test("an author's page from a card, with a follow that asks a guest to sign in", async ({
  page,
}) => {
  await mockBackend(page);
  await page.route("**/lists?**", (route) =>
    route.fulfill({ json: { lists: [summary], nextCursor: null } }),
  );
  await page.route(`**/lists/follow/${list.authorUid}`, (route) =>
    route.fulfill({ json: { following: false, followers: 3 } }),
  );

  await page.goto("/");
  await page
    .getByRole("link", { name: /by danylo/ })
    .first()
    .click();
  await expect(page).toHaveURL(`/u/${list.authorUid}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("danylo");
  await expect(page.getByText("3 followers · 1 public list")).toBeVisible();
  await expect(page.getByRole("link", { name: /Every A24 film, ranked/ })).toBeVisible();

  await page.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to follow" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the foot of every page leads to the credits, with TMDB's logo and sentence", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  // The foot is drawn before the list is. Pressed then, the link is aimed at
  // where it was: the list arrives, the foot moves down, and the press lands
  // on nothing. A person waits for the page too.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(
    page.getByText("This product uses the TMDB API but is not endorsed or certified by TMDB."),
  ).toBeVisible();
  const logo = page.getByRole("img", { name: "TMDB" });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test("a menu closes on a press anywhere else, and a new page opens at its top", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await page.getByLabel("More about this list").click();
  await expect(page.getByRole("button", { name: "Hide this list" })).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(page.getByRole("button", { name: "Hide this list" })).toBeHidden();

  // The page a link leads to used to open as far down as the one it was pressed on.
  await page.evaluate(() => {
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 1200);
  });
  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
