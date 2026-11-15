import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";

/** Four pictured cards in S, three in the pool: names only in their labels. */
function boardOf(uid: string, displayMode: string) {
  return {
    uid,
    title: "Names " + uid,
    displayMode,
    tiers: ["S", "A", "Pool"].map((label, i) => ({
      uid: label,
      label,
      isPool: i === 2,
      position: i,
    })),
    items: Array.from({ length: 7 }, (_, i) => ({
      uid: "c" + i,
      title: "Card " + i,
      imageUrl: "/favicon.svg",
      tierUid: i < 4 ? "S" : "Pool",
      position: i,
      deletedAt: null,
    })),
  };
}

async function open(page: Page, uid: string, displayMode = "WRAP") {
  await mockBackend(page);
  await page.route("**/lists/sections", (r) => r.fulfill({ json: { sections: [] } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ key, board }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(board));
    },
    { key: "tyl:board:" + uid, board: boardOf(uid, displayMode) },
  );
  await page.goto("/b/" + uid);
  await expect(page.locator(".tier [data-item]")).toHaveCount(4);
}

const tip = (page: Page) => page.locator(".name-tip");
const card = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function restOn(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  return box;
}

for (const [view, mode] of [
  ["rows that wrap", "WRAP"],
  ["one strip per tier", "HORIZONTAL_SCROLL"],
] as const) {
  test(`a pictured card says its name under a resting mouse, in a tier and in the pool: ${view}`, async ({
    page,
    hasTouch,
  }) => {
    test.skip(hasTouch, "a finger has no hover; a tap goes on doing what it did");
    await open(page, "names-" + mode.toLowerCase(), mode);
    const box = await restOn(page, card(page, "Card 1"));
    await expect(tip(page)).toHaveText("Card 1");
    // Over the card, not on it: the card stays in sight.
    const shown = (await tip(page).boundingBox())!;
    expect(shown.y + shown.height).toBeLessThanOrEqual(box.y + 1);
    await restOn(page, card(page, "Card 5"));
    await expect(tip(page)).toHaveText("Card 5");
    await page.mouse.move(2, 2);
    await expect(tip(page)).toHaveCount(0);
  });
}

test("the keyboard on a pictured card says its name too, and a press hides it", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "a keyboard's focus");
  await open(page, "names-keys");
  await card(page, "Card 0").focus();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  expect(focused).toMatch(/^Card \d$/);
  await expect(tip(page)).toHaveText(focused!);
  await page.keyboard.press("Escape");
  await expect(tip(page)).toHaveCount(0);
});

test("a tap on a phone shows no name over the card", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "a finger's tap");
  await open(page, "names-tap");
  await card(page, "Card 1").tap();
  await expect(card(page, "Card 1")).toHaveAttribute("aria-pressed", "true");
  await expect(tip(page)).toHaveCount(0);
});

/**
 * One place over by a short move, the same length either way: the card's
 * middle goes a little over half the step between two cards. Held near its
 * far edge, so the pointer leads the card's middle the wrong way: the place
 * goes by the card, not the pointer.
 */
for (const [where, row] of [
  ["a tier", ".tier__items"],
  ["the pool", ".pool__items"],
] as const) {
  test(`a card goes one place left as readily as right, in ${where}`, async ({
    page,
    hasTouch,
  }) => {
    test.skip(hasTouch, "a mouse drag; a finger has the move sheet and the keys");
    await open(page, "places-" + (row === ".tier__items" ? "tier" : "pool"));
    const cards = page.locator(`${row} [data-item]`);
    const order = () =>
      cards.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")));
    const start = await order();
    const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
    const step = b.x - a.x;
    /** Carries the card at `place` by `by` steps, held at `hold` of its width, and lets go. */
    const carry = async (place: number, by: number, hold: number) => {
      const box = (await cards.nth(place).boundingBox())!;
      const from = { x: box.x + box.width * hold, y: box.y + box.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + by * step, from.y, { steps: 10 });
      await page.mouse.up();
    };
    const swapped = (n: number) => {
      const next = [...start];
      [next[n], next[n + 1]] = [next[n + 1]!, next[n]!];
      return next;
    };
    // A third of a step either way moves nothing.
    await carry(1, -0.35, 0.85);
    await expect.poll(order).toEqual(start);
    await carry(1, 0.35, 0.15);
    await expect.poll(order).toEqual(start);
    // Two thirds of a step: left, held by its right edge; then back right, held by its left edge.
    await carry(1, -0.65, 0.85);
    await expect.poll(order).toEqual(swapped(0));
    await carry(0, 0.65, 0.15);
    await expect.poll(order).toEqual(start);
  });
}
