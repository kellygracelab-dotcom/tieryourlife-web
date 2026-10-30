import { expect, test, type Locator, type Page } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

/** A press the way the project's device makes it: a finger taps, a mouse clicks. */
const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

/**
 * A double tap on a card, as on the phone; a mouse double-clicks. The second
 * tap lands where the first did, as a finger's would, without waiting for the
 * picked card to settle.
 */
async function doubleTap(page: Page, target: Locator, touch: boolean) {
  if (!touch) return target.dblclick();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("the card is not laid out");
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.touchscreen.tap(at.x, at.y);
  await page.touchscreen.tap(at.x, at.y);
}

/** A board of one's own with three cards, one of them ranked, made the way a person makes it. */
async function makeBoard(page: Page, touch: boolean) {
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Films I make people watch");
  await title.press("Enter");
  // An empty pool has the box that brings cards in open on a wide window, behind + Add on a phone.
  if (touch) await press(page.getByRole("button", { name: "Add", exact: true }), touch);
  for (const name of ["Ex Machina", "The Witch", "Climax"]) {
    const add = page.getByRole("textbox", { name: "Add a card" });
    await add.fill(name);
    await add.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // The card's menu by a double tap, as on the phone: any tier by a press, no
  // keyboard needed. Nothing sits on the card itself to be hit by mistake.
  const card = page.getByRole("button", { name: "Ex Machina", exact: true });
  if (!touch) await card.hover();
  await expect(page.getByLabel(/^(Remove|Move) Ex Machina$/)).toHaveCount(0);
  await doubleTap(page, card, touch);
  const sheet = page.getByRole("dialog", { name: "Ex Machina" });
  // The sheet is where a card leaves the list.
  await expect(sheet.getByRole("button", { name: "Remove from list" })).toBeVisible();
  if (!touch) {
    // The keyboard stays in the sheet, round and round.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((box) => box.contains(document.activeElement))).toBe(true);
    }
  }
  await press(sheet.getByRole("button", { name: "S", exact: true }), touch);
  await expect(page.getByText(/1 ranked · 2 in pool/)).toBeVisible();
}

test("New list opens a new board, where the list is made", async ({ page, hasTouch }) => {
  await mockBackend(page);
  await page.goto("/");
  await press(page.getByRole("link", { name: "New list" }), hasTouch);
  await expect(page).toHaveURL(/\/b\/[^?]+\?new=/);
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Cheeses");
  await title.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cheeses");
  await expect(page.getByRole("button", { name: "Add tier" })).toBeVisible();
  // Nothing in the pool yet: it says so, and the catalogue's box takes the cursor,
  // at once on a wide window, from + Add on a phone.
  await expect(page.getByRole("heading", { name: "Pool · 0" })).toBeVisible();
  await expect(page.getByText("Add cards by name, or search the catalogue.")).toBeVisible();
  if (hasTouch) await press(page.getByRole("button", { name: "Add", exact: true }), hasTouch);
  await expect(page.getByRole("textbox", { name: "Add a card" })).toBeFocused();
});

test("the old /new and a suggestion of the empty page make a list in its section", async ({
  page,
  hasTouch,
}) => {
  await mockBackend(page);
  await page.goto("/new?title=Ramen");
  await expect(page).toHaveURL(/\/b\/[^?]+\?new=\d+&title=Ramen$/);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Ramen");

  await page.goto("/b");
  await expect(page.getByText("No lists yet")).toBeVisible();
  await press(page.getByRole("link", { name: "Restaurants" }), hasTouch);
  await expect(page).toHaveURL(/\/b\/[^?]+\?new=\d+&category=food$/);
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Ramen in Kyiv");
  await title.press("Enter");
  await expect(page.getByText(/Food/)).toBeVisible();
});

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
  // A guest's switch asks them to sign in; the words under it say why.
  const publicSwitch = page.getByRole("switch", { name: "Public" });
  await expect(publicSwitch).toBeVisible();
  await expect(publicSwitch).toBeEnabled();
  await expect(page.getByText(/Sign in with Google to publish/)).toBeVisible();
  await page.getByRole("button", { name: /Cover/ }).click();
  await expect(page.getByText("None of this list's cards have a picture yet.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog", { name: "List settings" })).toBeHidden();

  // Share as image is in the board's menu, and draws a file.
  await page.getByLabel("More about this board").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share as image" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("changes the tiers on the board: a tap opens one, its band carries it, one more goes under", async ({
  page,
  hasTouch,
  browserName,
}) => {
  await mockBackend(page);
  await makeBoard(page, hasTouch);
  const rows = page.locator(".board > .tier");
  const labels = () => page.locator(".board > .tier .tier__label").allTextContents();
  expect(await labels()).toEqual(["S", "A", "B", "C", "D"]);

  // One tap on the band with a finger; a mouse double-clicks.
  const firstBand = rows.first().locator(".tier__band");
  if (hasTouch) await firstBand.tap();
  else await firstBand.dblclick();
  const dialog = page.getByRole("dialog", { name: "Edit tier" });
  await dialog.getByRole("textbox", { name: "Label" }).fill("Top");
  await press(dialog.getByRole("button", { name: "Save" }), hasTouch);
  await expect(dialog).toBeHidden();
  expect(await labels()).toEqual(["Top", "A", "B", "C", "D"]);

  // Under the last tier, where a phone's tray may lie over it until the page scrolls.
  const addTier = page.getByRole("button", { name: "Add tier" });
  await addTier.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await press(addTier, hasTouch);
  // Its editor opens on the tier to be, made by its own Add tier.
  const making = page.getByRole("dialog", { name: "New tier" });
  await press(making.getByRole("button", { name: "Add tier" }), hasTouch);
  await expect(making).toBeHidden();
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

test("moves a card along its row: the others make room at once, and nothing is picked by the drag", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "a mouse drag; a finger has the move sheet and the keys");
  await mockBackend(page);
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Films");
  await title.press("Enter");
  // The empty pool's box is open on a wide window, the cursor in it.
  for (const name of ["Ex Machina", "The Witch", "Climax"]) {
    const add = page.getByRole("textbox", { name: "Add a card" });
    await add.fill(name);
    await add.press("Enter");
  }
  const s = page.getByRole("list", { name: "S", exact: true });
  const order = () =>
    s
      .locator("[data-item]")
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")));
  const carry = async (name: string, to: { x: number; y: number }) => {
    const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
  };
  const row = (await s.boundingBox())!;
  for (const name of ["Ex Machina", "The Witch", "Climax"]) {
    await carry(name, { x: row.x + row.width - 20, y: row.y + row.height / 2 });
    // From the pool, an empty place of the card's size waits in the row.
    await expect(s.locator(".tile--slot")).toHaveCount(1);
    await page.mouse.up();
  }
  await expect.poll(order).toEqual(["Ex Machina", "The Witch", "Climax"]);

  // Climax carried to the front: it stands there before it is let go, with no bar.
  const first = (await s.locator("[data-item]").first().boundingBox())!;
  await carry("Climax", { x: first.x + 5, y: first.y + first.height / 2 });
  // The row redraws a frame after the last move; read it once it has.
  await expect.poll(order).toEqual(["Climax", "Ex Machina", "The Witch"]);
  await page.mouse.up();
  await expect.poll(order).toEqual(["Climax", "Ex Machina", "The Witch"]);
  await expect(page.locator(".tile--selected")).toHaveCount(0);

  // The board keeps it so.
  await page.reload();
  await expect(s.locator("[data-item]")).toHaveCount(3);
  expect(await order()).toEqual(["Climax", "Ex Machina", "The Witch"]);
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
  await page.getByRole("link", { name: "Your lists" }).first().click();
  await expect(page.getByRole("link", { name: `Open ${list.title}` })).toBeVisible();
});
