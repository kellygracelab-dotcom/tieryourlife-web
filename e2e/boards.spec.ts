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
  const sheet = page.getByRole("dialog", { name: "Ex Machina" });
  if (touch) {
    // On a touch screen the sheet is where a card leaves the list; the cross steps aside.
    await expect(sheet.getByRole("button", { name: "Remove from list" })).toBeVisible();
    await expect(page.getByLabel("Remove Ex Machina", { exact: true })).toBeHidden();
  } else {
    // The keyboard stays in the sheet, round and round.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((box) => box.contains(document.activeElement))).toBe(true);
    }
  }
  await press(sheet.getByRole("button", { name: "S", exact: true }), touch);
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

test("changes the tiers on the board: a double tap opens one, its band carries it, one more goes under", async ({
  page,
  hasTouch,
  browserName,
}) => {
  await mockBackend(page);
  await makeBoard(page, hasTouch);
  const rows = page.locator(".board > .tier");
  const labels = () => page.locator(".board > .tier .tier__label").allTextContents();
  expect(await labels()).toEqual(["S", "A", "B", "C", "D"]);

  // Two taps on the band, as on the phone; a mouse double-clicks.
  const firstBand = rows.first().locator(".tier__band");
  if (hasTouch) {
    await firstBand.tap();
    await firstBand.tap();
  } else {
    await firstBand.dblclick();
  }
  const dialog = page.getByRole("dialog", { name: "Edit tier" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Top");
  await press(dialog.getByRole("button", { name: "Save" }), hasTouch);
  await expect(dialog).toBeHidden();
  expect(await labels()).toEqual(["Top", "A", "B", "C", "D"]);

  // Under the last tier, where a phone's tray may lie over it until the page scrolls.
  const addTier = page.getByRole("button", { name: "Add tier" });
  await addTier.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await press(addTier, hasTouch);
  // The first letter of the phone's row not in use: S, since it is called Top now.
  await expect.poll(labels).toEqual(["Top", "A", "B", "C", "D", "S"]);
  await page.evaluate(() => window.scrollTo(0, 0));

  // Carried by its band past A and B: a press and a move with a mouse, a
  // long press with a finger, and the page does not scroll under the finger.
  const from = (await firstBand.boundingBox())!;
  const third = (await rows.nth(2).boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: start.x, y: third.y + third.height / 2 + 10 };
  if (!hasTouch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await expect(rows.first()).toHaveClass(/tier--lifted/);
    await page.mouse.up();
  } else if (browserName === "chromium") {
    const scrolled = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: at === undefined ? [] : [{ x: at.x, y: at.y }],
      });
    await touch("touchStart", start);
    await page.waitForTimeout(450);
    await expect(rows.first()).toHaveClass(/tier--lifted/);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", { x: start.x, y: start.y + ((end.y - start.y) * i) / 10 });
    }
    await touch("touchEnd");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  } else {
    // WebKit has no way here to hold a finger and move it; the iPhone run stops at the taps.
    return;
  }
  await expect.poll(labels).toEqual(["A", "B", "Top", "C", "D", "S"]);
  // Its card went with it.
  await expect(
    page
      .getByRole("list", { name: "Top" })
      .getByRole("button", { name: "Ex Machina", exact: true }),
  ).toBeVisible();
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
