import { expect, test } from "@playwright/test";
import { LIST_ID, mockBackend } from "./fixtures";

// Artboard 13: on a phone somebody else's list keeps its whole title on a row
// of its own with ⋮ beside it, and Play and Save my list, 48 high, below.
test("a phone gives the list's title its own row, and Play and Save the row under it", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 600, "the phone layout");
  await mockBackend(page);
  await page.goto(`/l/${LIST_ID}`);
  const head = page.locator(".list-head");
  const title = await head.getByRole("heading", { level: 1 }).boundingBox();
  const more = await head.getByLabel("More about this list").boundingBox();
  const play = await head.getByRole("button", { name: "Play", exact: true }).boundingBox();
  const save = await head.locator(".list-head__save").boundingBox();
  expect(title && more && play && save).toBeTruthy();
  // ⋮ on the title's row, at its end; the buttons under the title, side by side.
  expect(more!.y).toBeLessThan(title!.y + title!.height);
  expect(more!.x).toBeGreaterThan(title!.x + title!.width - 1);
  expect(play!.y).toBeGreaterThan(title!.y + title!.height);
  expect(Math.abs(play!.y - save!.y)).toBeLessThan(2);
  expect(play!.height).toBeGreaterThanOrEqual(48);
  expect(save!.height).toBeGreaterThanOrEqual(48);
});

// Artboard 18: one's own list on a phone has one row, 64 high, and no site bar
// over it: back, the name with the one count under it, Publish, Play and ⋮.
test("a phone gives one's own list a one-row head with no site bar", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 600, "the phone layout");
  await mockBackend(page);
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Frieren characters");
  await title.press("Enter");
  const add = page.getByRole("textbox", { name: "Add a card" });
  if (!(await add.isVisible()))
    await page.getByRole("button", { name: "Add", exact: true }).click();
  await add.fill("Fern");
  await add.press("Enter");
  await expect(page.locator(".top")).toBeHidden();
  const head = page.locator(".list-head");
  const box = (await head.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(72);
  const centre = box.y + box.height / 2;
  for (const name of ["Publish", "Play"]) {
    const button = (await head.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(Math.abs(button.y + button.height / 2 - centre)).toBeLessThan(6);
    expect(button.height).toBeGreaterThanOrEqual(48);
  }
  const name = (await head.getByRole("heading", { level: 1 }).boundingBox())!;
  const count = (await head.getByText(/of 1 placed/).boundingBox())!;
  expect(count.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  // The view's button gives way; its choices are in ⋮.
  await expect(head.getByLabel(/^Display: /)).toBeHidden();
});
