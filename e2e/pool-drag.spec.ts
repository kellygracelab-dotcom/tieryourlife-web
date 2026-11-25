import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBackend, nameNewList } from "./fixtures";

/*
 * A card carried from the pool to a tier, from a tier to the pool, or along
 * the pool looks as one carried along its own tier: it stands faded where it
 * would land and the others make room (Danylo, 15.11.2026). The pool keeps
 * the order it is given, after a reload too.
 */

const NAMES = ["Ex Machina", "The Witch", "Climax", "Anora"];

const poolCards = (page: Page) => page.locator(".pool__items [data-item]");
const tierS = (page: Page) => page.getByRole("list", { name: "S", exact: true });
const names = (cards: Locator) =>
  cards.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")));
const lifted = (where: Locator) => where.locator(".tile--lifted");

async function newBoard(page: Page, touch: boolean) {
  await mockBackend(page);
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  await nameNewList(page, "Pool order");
  // The box that brings cards in is open on a wide window, in a sheet on a phone.
  if (touch) await page.getByRole("button", { name: "Search or type a name" }).tap();
  for (const name of NAMES) {
    const add = page.getByRole("textbox", { name: "Add a card" });
    await add.fill(name);
    await add.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // The sheet closed again: the tray is short, and no row lies under it.
  if (touch) {
    await page.getByRole("button", { name: /^Done/ }).tap();
    await expect(page.getByRole("dialog", { name: "Add cards" })).toBeHidden();
  }
  await expect(poolCards(page)).toHaveCount(NAMES.length);
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Measured where they stand: the pool is docked to the window's foot, and
// the board stays scrolled to its top, where tier S is.
const middle = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("not laid out");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

/**
 * A card taken up and carried to a point, not let go yet: a mouse, or a
 * finger held long enough to lift it. Playwright's touchscreen only taps, and
 * the board listens to pointer events, so those are sent as a finger would.
 */
async function carry(page: Page, touch: boolean, card: Locator, to: { x: number; y: number }) {
  const from = await middle(card);
  if (!touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    return;
  }
  const handle = await card.elementHandle();
  await page.evaluate(
    async ({ tile, origin, to }) => {
      const send = (target: EventTarget, type: string, at: { x: number; y: number }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            button: 0,
          }),
        );
      send(tile!, "pointerdown", origin);
      await new Promise((resolve) => setTimeout(resolve, 250));
      for (let step = 1; step <= 12; step++) {
        send(window, "pointermove", {
          x: origin.x + ((to.x - origin.x) * step) / 12,
          y: origin.y + ((to.y - origin.y) * step) / 12,
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      // A finger never stands quite still: one more move where it rests, a few frames on.
      for (let frame = 0; frame < 3; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      send(window, "pointermove", to);
    },
    { tile: handle, origin: { x: from.x, y: from.y }, to },
  );
}

async function letGo(page: Page, touch: boolean, at: { x: number; y: number }) {
  if (!touch) return page.mouse.up();
  await page.evaluate((point) => {
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
      }),
    );
  }, at);
}

test("a card carried from the pool, back to it and along it looks as one carried along its tier, and the pool keeps its order", async ({
  page,
  hasTouch,
}) => {
  await newBoard(page, hasTouch);
  const start = await names(poolCards(page));
  const [first, second, , last] = start as string[];

  // Pool → tier S: the card stands faded in the row, gone from the pool.
  // The tier itself: its list of cards may lie over more than the row.
  const row = await middle(page.locator('.tier[data-drop="tier:0"]'));
  const into = { x: row.box.x + row.box.width - 24, y: row.y };
  await carry(page, hasTouch, page.getByRole("button", { name: first, exact: true }), into);
  await expect(lifted(tierS(page))).toHaveAccessibleName(first!);
  await expect.poll(() => names(poolCards(page))).not.toContain(first);
  await letGo(page, hasTouch, into);
  await expect.poll(() => names(tierS(page).locator("[data-item]"))).toEqual([first]);
  await expect(lifted(page.locator(".ranking"))).toHaveCount(0);

  // Tier S → the pool's front: faded there, and the pool's first card makes room.
  const head = await middle(page.getByRole("button", { name: second, exact: true }));
  const before = { x: head.box.x + 4, y: head.y };
  await carry(page, hasTouch, tierS(page).getByRole("button", { name: first }), before);
  await expect(lifted(page.locator(".pool__items"))).toHaveAccessibleName(first!);
  await expect.poll(() => names(poolCards(page))).toEqual(start);
  await expect(tierS(page).locator("[data-item]")).toHaveCount(0);
  // The card that was first moved over by a card's width and the gap, as along a tier.
  const moved = (await page.getByRole("button", { name: second, exact: true }).boundingBox())!;
  expect(Math.abs(moved.x - head.box.x) + Math.abs(moved.y - head.box.y)).toBeGreaterThan(
    head.box.width / 2,
  );
  await letGo(page, hasTouch, before);
  await expect.poll(() => names(poolCards(page))).toEqual(start);

  // Along the pool: the last card to the front, the others make room before it is let go.
  const front = await middle(page.getByRole("button", { name: first, exact: true }));
  const toFront = { x: front.box.x + 4, y: front.y };
  await carry(page, hasTouch, page.getByRole("button", { name: last, exact: true }), toFront);
  const reordered = [last, ...start.filter((name) => name !== last)];
  await expect.poll(() => names(poolCards(page))).toEqual(reordered);
  await expect(lifted(page.locator(".pool__items"))).toHaveAccessibleName(last!);
  await letGo(page, hasTouch, toFront);
  await expect.poll(() => names(poolCards(page))).toEqual(reordered);
  await expect(page.locator(".tile--selected")).toHaveCount(0);

  // The board keeps the pool's order.
  await page.reload();
  await expect(poolCards(page)).toHaveCount(NAMES.length);
  expect(await names(poolCards(page))).toEqual(reordered);
});

test("the keys move a picked card along the pool, and the order is kept", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the keys; a finger drags");
  await newBoard(page, false);
  const start = (await names(poolCards(page))) as string[];
  await page.getByRole("button", { name: start[0], exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const stepped = [start[1], start[2], start[0], start[3]];
  await expect.poll(() => names(poolCards(page))).toEqual(stepped);
  // Still picked, for the next step.
  await expect(page.getByRole("button", { name: start[0], exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(poolCards(page)).toHaveCount(NAMES.length);
  expect(await names(poolCards(page))).toEqual(stepped);
});
