import { expect, test, type Page } from "@playwright/test";
import { device, newBoard, person, signIn, stored, text } from "./emulated";

/*
 * Publishing against the real proxy: what the site sends is what the proxy
 * accepts, the list it stores is the one others read, and a publish whose
 * answer was lost does not make a second list.
 */

async function openSettings(page: Page) {
  await page.getByLabel("More about this board").click();
  await page.getByRole("button", { name: "List settings" }).click();
}

async function setCategory(page: Page) {
  await page.getByRole("button", { name: /Category/ }).click();
  await page.getByRole("radio", { name: "Film & TV" }).click();
}

/** The published list's own address, from List settings' link to it. */
async function listHref(page: Page): Promise<string> {
  const href = await page.getByRole("link", { name: "See it in Community" }).getAttribute("href");
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
  await openSettings(page);
  await setCategory(page);

  const publicSwitch = page.getByRole("switch", { name: "Public" });
  await publicSwitch.click();
  await expect(page.getByText("Published. Anyone with the link can rank it.")).toBeVisible();
  await expect(publicSwitch).toBeChecked();
  const href = await listHref(page);

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

  // A change on the board, then Update: the same list, the new order.
  await page.getByRole("radio", { name: "Ranking" }).click();
  await expect(page.getByText("The published copy is behind this board.")).toBeVisible();
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText("The published copy is behind this board.")).toBeHidden();
  expect(await listsTitled(title)).toHaveLength(1);

  // Taken down: the proxy forgets it and the guest's link stops working.
  await publicSwitch.click();
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
  await openSettings(page);
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
  const publicSwitch = page.getByRole("switch", { name: "Public" });
  await publicSwitch.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(publicSwitch).not.toBeChecked();
  expect(await listsTitled(title)).toHaveLength(1);

  // The person tries again: the proxy knows the board and answers with the
  // list it already has, so there is still one.
  await publicSwitch.click();
  await expect(page.getByText("Published. Anyone with the link can rank it.")).toBeVisible();
  expect(await listsTitled(title)).toHaveLength(1);
  const href = await listHref(page);
  expect((await listsTitled(title))[0]?.name.endsWith(href.slice(3))).toBe(true);
});
