import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";

/** A list of one's own, its name only, made the way a person makes it; then Your lists. */
async function makeList(page: Page, name: string) {
  await page.goto("/b/new");
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill(name);
  await title.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.goto("/b");
}

test("a list's own menu in Your lists: in the window, Play kept with its reason, Delete with Undo (artboard 39)", async ({
  page,
  hasTouch,
}) => {
  await mockBackend(page);
  await makeList(page, "Cheeses");
  const list = page.getByRole("link", { name: "Open Cheeses" });
  // A finger has ⋮ always; a mouse has the right click, at the pointer.
  if (hasTouch) await page.getByRole("button", { name: "More for Cheeses" }).tap();
  else await list.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "More for Cheeses" });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("0 cards · nothing placed yet · private");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  // Within the window, whichever side of the pointer it had to open on.
  const box = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await expect(menu.getByRole("menuitem", { name: /Play/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await menu.getByRole("menuitem", { name: /Delete/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByText("1 list deleted")).toBeVisible();
  await expect(list).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list).toBeVisible();
});
