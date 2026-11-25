import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";

/*
 * The pool one card at a time, as the phone app has it (agreed with Android,
 * 15.11.2026): the card large, a button for every tier, Skip. A tier puts the
 * card last in it and the pool's next comes up; Skip comes back round; a card
 * tapped on the board comes up too, and To the pool sends it to the pool's
 * end. The choice is the device's and outlives a reload.
 */

const NAMES = ["Ex Machina", "The Witch", "Climax", "Anora"];

const poolCards = (page: Page) => page.locator(".pool__items [data-item]");
const tier = (page: Page, label: string) => page.getByRole("list", { name: label, exact: true });
const names = (cards: Locator) =>
  cards.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")));
const up = (page: Page) => page.locator(".one__name");
const toggle = (page: Page) => page.getByRole("button", { name: "One by one" });

async function newBoard(page: Page, touch: boolean) {
  await mockBackend(page);
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("One by one");
  await title.press("Enter");
  if (touch) await page.getByRole("button", { name: "Search or type a name" }).tap();
  for (const name of NAMES) {
    const add = page.getByRole("textbox", { name: "Add a card" });
    await add.fill(name);
    await add.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  if (touch) {
    await page.getByRole("button", { name: /^Done/ }).tap();
    await expect(page.getByRole("dialog", { name: "Add cards" })).toBeHidden();
  }
  await expect(poolCards(page)).toHaveCount(NAMES.length);
  return (await names(poolCards(page))) as string[];
}

test("one card at a time: a tier places it, Skip comes back round, a card from the board moves or goes back to the pool", async ({
  page,
  hasTouch,
}) => {
  const press = (target: Locator) => (hasTouch ? target.tap() : target.click());
  const place = (name: string, label: string) =>
    press(
      page.locator(".one").getByRole("button", { name: `Place ${name} in ${label}`, exact: true }),
    );
  const [a, b, c, d] = await newBoard(page, hasTouch);

  // The switch stays where it was pressed (Content, 15.11.2026: it ran off from under the pointer).
  const was = await toggle(page).boundingBox();
  await press(toggle(page));
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(poolCards(page)).toHaveCount(0);
  expect((await toggle(page).boundingBox())?.x).toBeCloseTo(was!.x, 0);
  await expect(up(page)).toHaveText(a!);

  // A tier: the card goes last in it and the pool's next comes up.
  await place(a!, "S");
  await expect.poll(() => names(tier(page, "S").locator("[data-item]"))).toEqual([a]);
  await expect(up(page)).toHaveText(b!);

  // Skip: the next one, the skipped card waits.
  await press(page.getByRole("button", { name: "Skip" }));
  await expect(up(page)).toHaveText(c!);
  await place(c!, "A");
  await expect(up(page)).toHaveText(d!);
  await place(d!, "S");
  await expect.poll(() => names(tier(page, "S").locator("[data-item]"))).toEqual([a, d]);
  // Round to the card skipped, the last one: nothing to skip to.
  await expect(up(page)).toHaveText(b!);
  await expect(page.getByRole("button", { name: "Skip" })).toBeDisabled();
  await place(b!, "B");
  await expect(page.getByText("Every card is in place")).toBeVisible();

  // A card on the board, tapped: it comes up, its tier ringed; another tier moves it last there.
  await press(tier(page, "S").getByRole("button", { name: a, exact: true }));
  await expect(up(page)).toHaveText(a!);
  await expect(
    page.locator(".one").getByRole("button", { name: `Place ${a} in S`, exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await place(a!, "B");
  await expect.poll(() => names(tier(page, "B").locator("[data-item]"))).toEqual([b, a]);
  await expect(page.getByText("Every card is in place")).toBeVisible();

  // To the pool: it waits there, up again.
  await press(tier(page, "A").getByRole("button", { name: c, exact: true }));
  await press(page.getByRole("button", { name: "To the deck" }));
  await expect.poll(() => names(tier(page, "A").locator("[data-item]"))).toEqual([]);
  await expect(up(page)).toHaveText(c!);

  // The device remembers the choice.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(up(page)).toHaveText(c!);

  // Every card at once again.
  await press(toggle(page));
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => names(poolCards(page))).toEqual([c]);
  await expect(page.locator(".one")).toHaveCount(0);
});

test("one card at a time by keys: a number places it, Space skips, Backspace sends a card back, Ctrl+Z undoes", async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, "the keys; a finger taps");
  const [a, b, c, d] = await newBoard(page, false);
  await toggle(page).click();
  await expect(up(page)).toHaveText(a!);

  await page.keyboard.press("1");
  await expect.poll(() => names(tier(page, "S").locator("[data-item]"))).toEqual([a]);
  await expect(up(page)).toHaveText(b!);
  await page.keyboard.press(" ");
  await expect(up(page)).toHaveText(c!);
  await page.keyboard.press("2");
  await expect.poll(() => names(tier(page, "A").locator("[data-item]"))).toEqual([c]);
  await expect(up(page)).toHaveText(d!);

  // A tier's button pressed with the mouse keeps no focus: Space still skips.
  await page
    .locator(".one")
    .getByRole("button", { name: `Place ${d} in B`, exact: true })
    .click();
  await expect(up(page)).toHaveText(b!);
  await page.keyboard.press(" ");
  await expect(up(page)).toHaveText(b!);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");

  // A card on the board picked, Backspace: back to the pool's end.
  await tier(page, "S").getByRole("button", { name: a, exact: true }).click();
  await expect(up(page)).toHaveText(a!);
  await page.keyboard.press("Backspace");
  await expect.poll(() => names(tier(page, "S").locator("[data-item]"))).toEqual([]);
  await expect(up(page)).toHaveText(b!);

  await page.keyboard.press("Control+z");
  await expect.poll(() => names(tier(page, "S").locator("[data-item]"))).toEqual([a]);
});
