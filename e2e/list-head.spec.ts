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

// Artboard 38 (on 18): one's own list on a phone has no site bar; back,
// Publish, Play and ⋮ in the first row, the name whole under them, then the
// count. Scrolled, the head stays at the top in one row, 64 high.
test("a phone gives one's own list its buttons over the whole name, and one row once scrolled", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 600, "the phone layout");
  await mockBackend(page);
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Frieren characters, every one");
  await title.press("Enter");
  const add = page.getByRole("textbox", { name: "Add a card" });
  if (!(await add.isVisible()))
    await page.getByRole("button", { name: "Add", exact: true }).click();
  await add.fill("Fern");
  await add.press("Enter");
  await expect(page.locator(".top")).toBeHidden();
  const head = page.locator(".list-head");
  const heading = head.getByRole("heading", { level: 1 });
  const row = async () => {
    const publish = (await head
      .getByRole("button", { name: "Publish", exact: true })
      .boundingBox())!;
    const play = (await head.getByRole("button", { name: "Play", exact: true }).boundingBox())!;
    expect(Math.abs(publish.y - play.y)).toBeLessThan(2);
    expect(play.height).toBeGreaterThanOrEqual(48);
    return play;
  };

  let play = await row();
  let name = (await heading.boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(play.y + play.height - 1);
  // The name whole, on as many lines as it takes.
  expect(await heading.evaluate((h) => h.scrollWidth <= h.clientWidth)).toBe(true);
  await expect(heading).toHaveText("Frieren characters, every one");
  let count = (await head.getByText(/of 1 placed/).boundingBox())!;
  expect(count.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await expect(head.getByLabel(/^Display: /)).toBeHidden();

  // Room to scroll, then the head in one row at the top.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "1200px";
    window.scrollTo(0, 400);
  });
  await expect(head).toHaveClass(/list-head--tight/);
  const box = (await head.boundingBox())!;
  expect(Math.abs(box.y)).toBeLessThan(2);
  expect(box.height).toBeLessThanOrEqual(72);
  play = await row();
  name = (await heading.boundingBox())!;
  expect(Math.abs(play.y + play.height / 2 - (box.y + box.height / 2))).toBeLessThan(6);
  count = (await head.getByText(/of 1 placed/).boundingBox())!;
  expect(count.y).toBeGreaterThanOrEqual(name.y + name.height - 1);

  // Back at the top, the name whole again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(head).not.toHaveClass(/list-head--tight/);
});

// Artboard 21: somebody else's list on a wide, tall window has its cards
// beside the board, the list's buttons over the board's right edge rather
// than the window's, and its section and count under the name.
test("a wide window shows somebody else's list with its cards beside the board", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the desktop layout");
  await mockBackend(page);
  await page.setViewportSize({ width: 2560, height: 1271 });
  await page.goto(`/l/${LIST_ID}`);
  await expect(page.locator(".list-head__count")).toHaveText(/^.+ · \d+ cards?$/);
  const pool = (await page.locator(".ranking__side").boundingBox())!;
  const head = page.locator(".list-head");
  const lastTool = (await head.getByLabel("More about this list").boundingBox())!;
  expect(Math.abs(lastTool.x + lastTool.width - (pool.x + pool.width))).toBeLessThan(24);
  const title = (await head.getByRole("heading", { level: 1 }).boundingBox())!;
  const board = (await page.locator(".board").first().boundingBox())!;
  // The cards beside the board, level with its top, not docked under it.
  expect(pool.x).toBeGreaterThan(board.x + board.width);
  expect(Math.abs(pool.y - board.y)).toBeLessThan(24);
  expect(Math.abs(title.x - board.x)).toBeLessThan(24);
});

// Artboard 31: somebody else's list on a laptop has a column about a third of
// the window, cards 88 × 124 four to a row, one scroll (the page's), and Play
// filled among outlined buttons.
test("a laptop shows somebody else's cards four to a row in a column with no scroll of its own", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the desktop layout");
  await mockBackend(page);
  await page.setViewportSize({ width: 1351, height: 870 });
  await page.goto(`/l/${LIST_ID}`);
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await page.getByRole("button", { name: "Cards beside the tiers" }).click();
  const pool = page.locator(".ranking:not(.ranking--under) .pool");
  await expect(pool).toBeVisible();
  const box = (await pool.boundingBox())!;
  expect(box.width).toBeGreaterThan(400);
  expect(box.width).toBeLessThan(460);
  const items = pool.locator(".pool__items");
  expect(await items.evaluate((list) => getComputedStyle(list).gridTemplateColumns)).toBe(
    "88px 88px 88px 88px",
  );
  const tile = (await pool.locator(".tile").first().boundingBox())!;
  expect(Math.round(tile.height)).toBe(124);
  expect(await items.evaluate((list) => getComputedStyle(list).overflowY)).toBe("visible");
  const count = (await pool.locator(".pool__title").boundingBox())!;
  expect(count.height).toBeLessThan(30);
  const play = page.locator(".list-head").getByRole("button", { name: "Play", exact: true });
  expect(await play.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(
    "rgba(0, 0, 0, 0)",
  );
  await page.screenshot({ path: "../shots/31-laptop.png" });
});
