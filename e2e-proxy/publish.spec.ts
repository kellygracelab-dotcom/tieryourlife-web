import { expect, test, type Page } from "@playwright/test";
import { device, newBoard, person, signIn, stored, text } from "./emulated";

/*
 * Publishing against the real proxy: what the site sends is what the proxy
 * accepts, the list it stores is the one others read, and a publish whose
 * answer was lost does not make a second list.
 */

/** The Publish window, from the header's button beside Play. */
async function openPublish(page: Page) {
  await page.locator(".list-head .publish-button").click();
}

/** The publishing settings of a list out publicly: from Share's card, where Published stood. */
async function openSettings(page: Page) {
  await page.locator(".list-head .share-button").click();
  await page
    .getByRole("dialog", { name: "Share" })
    .getByRole("button", { name: "Publishing settings" })
    .click();
}

/** Out and up to date: Share, and no Publish or Update beside it. */
async function upToDate(page: Page) {
  await expect(page.locator(".list-head .share-button")).toBeVisible();
  await expect(page.locator(".list-head .publish-button")).toHaveCount(0);
}

async function setCategory(page: Page) {
  await page.getByRole("dialog").getByRole("radio", { name: "Film & TV" }).click();
}

/** The published list's own address, from its publishing settings. */
async function listHref(page: Page, title: string): Promise<string> {
  await openSettings(page);
  const out = page.getByRole("dialog", { name: title });
  const href = await out.getByRole("link", { name: "Open in Community" }).getAttribute("href");
  await out.getByRole("button", { name: "Done" }).click();
  expect(href).toMatch(/^\/l\/[A-Za-z0-9_-]+$/);
  return href ?? "";
}

const listsTitled = async (title: string) =>
  (await stored("publishedLists")).filter((doc) => text(doc, "title") === title);

test("publishes, is read by a guest, sends an update and takes it down", async ({
  page,
  browser,
}) => {
  const ana = person("Ana");
  const title = `Films for a rainy day ${Date.now()}`;
  await signIn(page, ana);
  await newBoard(page, title, ["Ex Machina", "The Witch"]);
  await openPublish(page);
  await setCategory(page);

  const word = page.locator(".list-head .publish-button__word");
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator(".snackbar")).toContainText("Your list is live");
  await upToDate(page);
  const href = await listHref(page, title);

  // The proxy kept one list, with its section and the board it came from.
  const [kept, ...more] = await listsTitled(title);
  expect(more).toHaveLength(0);
  expect(kept?.name.endsWith(href.slice(3))).toBe(true);
  expect(kept && text(kept, "category")).toBe("film_tv");
  expect(kept && text(kept, "boardUid")).toBeTruthy();

  // Somebody else, on another device and not signed in, reads it.
  const guest = await device(browser);
  await guest.goto(href);
  await expect(guest.getByRole("heading", { name: title })).toBeVisible();
  await expect(guest.getByText("Ex Machina")).toBeVisible();

  // A card added, then Update: the same list, with the new card.
  const box = page.getByRole("textbox", { name: "Add a card" });
  await box.fill("Hereditary");
  await box.press("Enter");
  await expect(word).toHaveText("Update");
  await page.locator(".list-head .publish-button").click();
  await upToDate(page);
  expect(await listsTitled(title)).toHaveLength(1);

  // Another way to show the board sends nothing: the list shows it as it is,
  // so there is nothing to Update (Coordinator, 23.11).
  await page.getByLabel("Display: Rows").click();
  await page.getByRole("menuitemradio", { name: /Ranked list/ }).click();
  await upToDate(page);

  // Taken down: the proxy forgets it and the guest's link stops working.
  await openSettings(page);
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Take it down" })
    .click();
  const ask = page.getByRole("group", { name: `Take ${title} down?` });
  await ask.getByRole("button", { name: "Take it down" }).click();
  await expect(page.getByText("Unpublished. The link no longer works.")).toBeVisible();
  await expect.poll(async () => (await listsTitled(title)).length).toBe(0);
  await guest.reload();
  await expect(guest.getByRole("heading", { name: title })).toBeHidden();
  await guest.context().close();
});

test("a publish whose answer was lost does not make a second list", async ({ page }) => {
  const bo = person("Bo");
  const title = `Cheeses worth the trip ${Date.now()}`;
  await signIn(page, bo);
  await newBoard(page, title, ["Comté", "Gouda"]);
  await openPublish(page);
  await setCategory(page);

  // The proxy gets the first publish and keeps the list, but its answer never
  // reaches the page: the line dropped on the way back.
  let lost = false;
  await page.route("**/lists", async (route) => {
    if (route.request().method() !== "POST" || lost) return route.fallback();
    lost = true;
    await route.fetch();
    await route.abort("connectionreset");
  });
  const window = page.getByRole("dialog", { name: `Publish “${title}”` });
  const publishButton = window.getByRole("button", { name: "Publish", exact: true });
  await publishButton.click();
  // The window goes at once; the lost answer is tried again by itself
  // (publish-update-speed BRIEF, 4): the proxy knows the board and answers
  // with the list it already has, so there is still one.
  await expect(window).toHaveCount(0);
  await expect(page.locator(".snackbar")).toContainText("Your list is live");
  expect(lost).toBe(true);
  expect(await listsTitled(title)).toHaveLength(1);
  const href = await listHref(page, title);
  expect((await listsTitled(title))[0]?.name.endsWith(href.slice(3))).toBe(true);
});
