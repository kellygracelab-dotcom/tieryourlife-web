import { expect, test, type Locator, type Page } from "@playwright/test";
import { list, mockBackend } from "./fixtures";
import { PIXEL } from "./signedIn";

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
  // A full page of pictures for every name, more than the box has room for.
  await page.route("**/lists/pictures?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    const items = Array.from({ length: 12 }, (_, at) => ({
      id: `tmdb:${q}${at}`,
      title: `${q} ${at}`,
      imageUrl: `https://img.test/${at}.png`,
      thumbUrl: null,
      source: "tmdb",
      kind: "movie",
    }));
    return route.fulfill({ json: { items, hasMore: true, notices: [] } });
  });
  await page.route("https://img.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  for (const name of ["Ex Machina", "The Witch", "Climax"]) {
    const add = page.getByRole("textbox", { name: "Add a card" });
    await add.fill(name);
    // The places to look stand whole, even in the pool's short dropdown.
    const places = page.getByRole("group", { name: "Where to look" });
    await expect(page.getByRole("button", { name: `${name} 11` })).toBeAttached();
    const chip = (await places.getByRole("button", { name: "All" }).boundingBox())!;
    expect((await places.boundingBox())!.height).toBeGreaterThanOrEqual(chip.height);
    await add.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // The card's menu by a double tap, as on the phone: any tier by a press, no
  // keyboard needed. Nothing sits on the card itself to be hit by mistake.
  const card = page.getByRole("button", { name: "Ex Machina", exact: true });
  if (!touch) await card.hover();
  await expect(page.getByLabel(/^(Remove|Move) Ex Machina$/)).toHaveCount(0);
  if (touch) {
    await doubleTap(page, card, touch);
    const sheet = page.getByRole("dialog", { name: "Ex Machina" });
    // The sheet is where a card leaves the list.
    await expect(sheet.getByRole("button", { name: "Remove from list" })).toBeVisible();
    await press(sheet.getByRole("button", { name: "S", exact: true }), touch);
  } else {
    // A mouse gets a menu where the pointer is, the tiers beside its first item.
    await card.dblclick();
    const menu = page.getByRole("menu", { name: "Ex Machina" });
    await expect(menu.getByRole("menuitem", { name: "Remove from list" })).toBeVisible();
    const at = (await card.boundingBox())!;
    const box = (await menu.boundingBox())!;
    expect(Math.abs(box.x - (at.x + at.width / 2))).toBeLessThan(2);
    // A menu at the bottom dock stays within the window's eight-pixel margin.
    const y = Math.min(at.y + at.height / 2, page.viewportSize()!.height - 8 - box.height);
    expect(Math.abs(box.y - y)).toBeLessThan(2);
    await expect(menu.getByRole("menuitem", { name: "Move to a tier" })).toBeFocused();
    // Escape is a change of mind; the context-menu key opens it again at the card.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(card).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    // The pointer on Move to a tier brings out the tiers, beside it.
    await card.click({ button: "right" });
    const item = menu.getByRole("menuitem", { name: "Move to a tier" });
    await item.hover();
    const tiers = page.getByRole("menu", { name: "Move to a tier" });
    await expect(tiers).toBeVisible();
    // After it, or before it where the window ends: the pool stands at the window's end.
    const side = (await item.boundingBox())!;
    const beside = (await tiers.boundingBox())!;
    expect(beside.x >= side.x + side.width - 1 || beside.x + beside.width <= side.x + 1).toBe(true);
    await tiers.getByRole("menuitem", { name: "S", exact: true }).click();
    await expect(menu).toBeHidden();
  }
  await expect(page.getByText(/1 of 3 placed/)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Cards left · 0" })).toBeVisible();
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
  await expect(page).toHaveURL(/\/b\/[^?]+\?new=\d+&title=Restaurants&category=food$/);
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Restaurants");
  await title.fill("Ramen in Kyiv");
  await title.press("Enter");
  // Its section: under the name, or on a phone's one-row head (artboard 18) only in the markup.
  await expect(page.locator(".list-head__meta")).toHaveText("Food");
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
  await expect(page.getByText(/1 of 3 placed/)).toBeVisible();

  // A guest's Publish opens the window, which says it signs them in first.
  await press(page.locator(".list-head .publish-button"), hasTouch);
  const window = page.getByRole("dialog", { name: "Publish “Films I make people watch”" });
  await expect(
    window.getByRole("button", { name: "Sign in and publish", exact: true }),
  ).toBeEnabled();
  await expect(window.getByText(/Publishing needs a Google account/)).toBeVisible();
  await press(window.getByRole("button", { name: "Cancel" }), hasTouch);
  await expect(window).toBeHidden();

  // The menu's Cover: a preview of the cover over the pictures, and nothing of publishing (artboard 41).
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Cover", exact: true }).click();
  const cover = page.getByRole("dialog", { name: "Cover" });
  await expect(cover.getByRole("region", { name: "Preview" })).toContainText("Tier colours · auto");
  await expect(cover.getByText("None of this list’s cards have a picture yet.")).toBeVisible();
  await expect(cover.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await cover.getByRole("button", { name: "Done" }).click();
  await expect(cover).toBeHidden();

  // Share as image is in the board's menu, and draws a file.
  await page.getByLabel("More about this list").click();
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
    // From the pool, the card itself stands faded at the row's end, as within a row.
    await expect(s.locator(".tile--lifted")).toHaveAccessibleName(name);
    await expect.poll(order).toContain(name);
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

test("the key that places the last card is not typed into the box that brings cards in", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "a keyboard's digit");
  await mockBackend(page);
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("One card");
  await title.press("Enter");
  const add = page.getByRole("textbox", { name: "Add a card" });
  await add.fill("Ex Machina");
  await add.press("Enter");
  await page.getByRole("button", { name: "Ex Machina", exact: true }).click();
  await page.keyboard.press("2");
  await expect(
    page.getByRole("list", { name: "A", exact: true }).getByRole("button", { name: "Ex Machina" }),
  ).toBeVisible();
  // The empty pool hands the cursor to the box, after the key, not into it.
  await expect(add).toBeFocused();
  await expect(add).toHaveValue("");
});

test("saves somebody's list to my boards with one button, and only once", async ({ page }) => {
  await mockBackend(page);
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);

  // On Author, the one button saves the author's arrangement; nothing asks whose.
  // A button in the head where there is room, a phone's included (artboard 13); else a line of ⋮.
  if (await page.locator(".list-head__save").isVisible()) {
    await page.locator(".list-head__save").click();
  } else {
    await page.getByLabel("More about this list").click();
    await page.getByRole("button", { name: "Save author’s list" }).click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Saved to your lists.")).toBeVisible();

  // Saved, the button opens the copy: the author's arrangement, the list's name, a board of mine.
  // On a phone it is a line of the ⋮ menu, which closed with the save.
  const saved = page.getByRole("button", { name: "Saved", exact: true }).first();
  if (!(await saved.isVisible())) await page.getByLabel("More about this list").click();
  await saved.click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  await expect(page.getByText(/2 of 3 placed/)).toBeVisible();
  await expect(
    page.getByRole("list", { name: "S" }).getByRole("button", { name: "Ex Machina", exact: true }),
  ).toBeVisible();

  // And it is on the shelf with the others, once.
  await page.getByRole("link", { name: "Your lists" }).first().click();
  await expect(page.getByRole("link", { name: `Open ${list.title}` })).toHaveCount(1);
});

// Artboard 23: on a wide window with the cards docked under the board, the
// catalogue's answers are a panel as wide as the board, one row of them.
test("a wide window's catalogue answers in a panel as wide as the board, one row", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the desktop layout");
  await mockBackend(page);
  await page.setViewportSize({ width: 2560, height: 1271 });
  await page.route("**/lists/pictures?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    const items = Array.from({ length: 14 }, (_, at) => ({
      id: `tmdb:${q}${at}`,
      title: `${q} ${at}`,
      imageUrl: `https://img.test/${at}.png`,
      thumbUrl: null,
      source: "tmdb",
      kind: "movie",
    }));
    return route.fulfill({ json: { items, hasMore: false, notices: [] } });
  });
  await page.route("https://img.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Dune and more");
  await title.press("Enter");
  await expect(page.locator(".ranking")).toHaveClass(/ranking--under/);
  await page.getByRole("textbox", { name: "Add a card" }).fill("dune");
  await expect(page.getByRole("button", { name: "dune 13" })).toBeAttached();

  const panel = (await page.locator(".pool__tools .cards__found").boundingBox())!;
  const board = (await page.locator(".board").first().boundingBox())!;
  expect(Math.abs(panel.x - board.x)).toBeLessThan(4);
  expect(Math.abs(panel.width - board.width)).toBeLessThan(4);
  const tops = await page
    .locator(".cards__pick")
    .evaluateAll((all) => all.map((one) => Math.round(one.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(page.locator(".cards__pick-hint")).toHaveText(
    "Click a result to add it. Enter adds “dune” as a card with just a name.",
  );
  // Enter still adds the name alone.
  await page.getByRole("textbox", { name: "Add a card" }).press("Enter");
  await expect(page.getByRole("button", { name: "dune", exact: true })).toBeVisible();
});

// Artboard 32: on a laptop, with the cards beside the board, the catalogue's
// answers stand in the column under the field, three to a row, in place of
// the cards, with the hint under them; the field's words are whole.
test("a laptop's column shows the catalogue's answers under the field in place of the cards", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the desktop layout");
  await mockBackend(page);
  await page.setViewportSize({ width: 1351, height: 870 });
  await page.route("**/lists/pictures?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    const items = Array.from({ length: 9 }, (_, at) => ({
      id: `tmdb:${q}${at}`,
      title: `${q} ${at}`,
      imageUrl: `https://img.test/${at}.png`,
      thumbUrl: null,
      source: "tmdb",
      kind: "movie",
    }));
    return route.fulfill({ json: { items, hasMore: false, notices: [] } });
  });
  await page.route("https://img.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Dune and more");
  await title.press("Enter");
  const add = page.getByRole("textbox", { name: "Add a card" });
  await add.fill("Fern");
  await add.press("Enter");
  await page.getByRole("button", { name: "Cards beside the tiers" }).click();
  await expect(page.locator(".ranking")).not.toHaveClass(/ranking--under/);
  await expect(page.locator(".pool__title")).toHaveText("1 card left");
  const count = (await page.locator(".pool__title").boundingBox())!;
  expect(count.height).toBeLessThan(30);
  expect(
    await add.evaluate((field: HTMLInputElement) => field.scrollWidth <= field.clientWidth),
  ).toBe(true);
  const placeholderFits = await add.evaluate((field: HTMLInputElement) => {
    const probe = document.createElement("span");
    probe.style.font = getComputedStyle(field).font;
    probe.style.whiteSpace = "pre";
    probe.textContent = field.placeholder;
    document.body.append(probe);
    const wide = probe.getBoundingClientRect().width;
    probe.remove();
    return wide <= field.clientWidth;
  });
  expect(placeholderFits).toBe(true);

  await add.fill("dune");
  await expect(page.getByRole("button", { name: "dune 8" })).toBeAttached();
  const column = (await page.locator(".pool").boundingBox())!;
  const found = (await page.locator(".pool__tools .cards__found").boundingBox())!;
  const field = (await add.boundingBox())!;
  expect(found.x).toBeGreaterThanOrEqual(column.x);
  expect(found.x + found.width).toBeLessThanOrEqual(column.x + column.width + 1);
  expect(found.y).toBeGreaterThan(field.y + field.height);
  const tops = await page
    .locator(".cards__pick")
    .evaluateAll((all) => all.map((one) => Math.round(one.getBoundingClientRect().top)));
  expect(tops.filter((top) => top === tops[0])).toHaveLength(3);
  await expect(page.locator(".pool__items")).toBeHidden();
  await expect(page.locator(".cards__pick-hint")).toHaveText(
    "Click a result to add it. Enter adds “dune” as a card with just a name.",
  );
  await add.press("Enter");
  await expect(page.getByRole("button", { name: "dune", exact: true })).toBeVisible();
});

test("a tier's band has no pencil: the band opens the tier at a press, and the keyboard finds it by Tab and Enter", async ({
  page,
  hasTouch,
}) => {
  await mockBackend(page);
  await page.goto("/b/new");
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Cheeses");
  await title.press("Enter");
  const band = page.locator(".board > .tier").first().locator(".tier__band");
  const edit = page.getByRole("button", { name: "Edit tier S" });
  // Nothing drawn on the band but its letter (Danylo, 18.11.2026), and a hand over it.
  await expect(edit).toBeAttached();
  await expect(edit.locator(".ms")).toHaveCount(0);
  expect(await band.evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");
  // A press on the band opens the tier.
  if (hasTouch) await band.tap();
  else await band.click();
  const dialog = page.getByRole("dialog", { name: "Edit tier" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  // The keyboard: the band's own button, ringed when focused, opens it with Enter.
  await edit.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
});
