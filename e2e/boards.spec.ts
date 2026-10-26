import { expect, test, type Locator, type Page } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

/** A press the way the project's device makes it: a finger taps, a mouse clicks. */
const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

/** A board of one's own with three cards, one of them ranked, made the way a person makes it. */
async function makeBoard(page: Page, touch: boolean) {
  await page.goto("/boards");
  await page.getByRole("button", { name: "New board" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Films I make people watch");
  await title.press("Enter");
  // On a narrow window the box that brings cards in waits behind Add, in the pool.
  const addButton = page.getByRole("button", { name: "Add", exact: true });
  if (await addButton.isVisible()) await press(addButton, touch);
  for (const name of ["Ex Machina", "The Witch", "Climax"]) {
    const add = page.getByRole("textbox", { name: "Add a card" });
    await add.fill(name);
    await add.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // The move sheet from the card: any tier by a press, no keyboard needed. A
  // finger finds the button on the card; a mouse sees it once the pointer is there.
  const move = page.getByLabel("Move Ex Machina", { exact: true });
  if (touch) {
    await move.tap();
  } else {
    await page.getByRole("button", { name: "Ex Machina", exact: true }).hover();
    await move.click();
  }
  await press(page.getByRole("dialog").getByRole("button", { name: "S", exact: true }), touch);
  await expect(page.getByText(/1 ranked · 2 in pool/)).toBeVisible();
}

test("keeps a new board, and its settings say why a guest cannot publish it", async ({
  page,
  hasTouch,
}) => {
  await mockBackend(page);
  await makeBoard(page, hasTouch);
  // The board is kept as it stands: a reload shows the same board.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Films I make people watch");
  await expect(page.getByText(/1 ranked · 2 in pool/)).toBeVisible();

  await page.getByLabel("More about this board").click();
  await page.getByRole("button", { name: "List settings" }).click();
  const publicSwitch = page.getByRole("switch", { name: "Public" });
  await expect(publicSwitch).toBeVisible();
  await expect(publicSwitch).toBeDisabled();
  await expect(page.getByText(/Sign in with Google to publish/)).toBeVisible();
  await expect(page.getByText("None of this list's cards have a picture yet.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Share as image is in the board's menu, and draws a file.
  await page.getByLabel("More about this board").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share as image" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("saves somebody's list to my boards, asking whose ranking to keep", async ({ page }) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);

  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Save to my lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Which ranking to save?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "The author's" }).click();
  await expect(page.getByText("Saved to your lists.")).toBeVisible();

  // Open leads to the copy: the author's arrangement, the list's name, a board of mine.
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  await expect(page.getByText(/2 ranked · 1 in pool/)).toBeVisible();
  await expect(
    page.getByRole("list", { name: "S" }).getByRole("button", { name: "Ex Machina", exact: true }),
  ).toBeVisible();

  // And it is on the shelf with the others.
  await page.getByRole("link", { name: "Your boards" }).first().click();
  await expect(page.getByRole("link", { name: `Open ${list.title}` })).toBeVisible();
});
