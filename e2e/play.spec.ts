import { expect, test, type Locator, type Page } from "@playwright/test";
import { LIST_ID, mockBackend } from "./fixtures";

const openMine = async (page: Page) => {
  await mockBackend(page);
  await page.goto(`/l/${LIST_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
  // A press that lands before the page has woken up is lost, so it is
  // repeated until Mine reads as pressed.
  const mine = page.getByRole("button", { name: "Mine", exact: true });
  await expect(async () => {
    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();
  await settled(page);
};

/**
 * Sheets slide and cards fade: a box measured mid-flight is in the wrong place.
 * A looping animation elsewhere on the page never ends, so only the finite ones are waited for.
 */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (motion) =>
          motion.playState !== "running" ||
          motion.effect?.getComputedTiming().iterations === Infinity,
      ),
  );

const boxOf = async (target: Locator) => {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const playButton = (page: Page) => page.getByRole("button", { name: "Play", exact: true });

test.describe("Play on a wide screen", () => {
  test.skip(({ hasTouch }) => hasTouch, "the desktop layout");

  test("Play sits in the header between the count and Undo, and opens a centred dialog", async ({
    page,
  }) => {
    await openMine(page);
    const head = page.locator(".list-head");
    const count = await boxOf(head.getByText(/of 3 placed/));
    const play = await boxOf(head.getByRole("button", { name: "Play", exact: true }));
    const undo = await boxOf(head.getByRole("button", { name: "Undo" }));
    // One row, in the app's order: count · Play · Undo.
    expect(count.x + count.width).toBeLessThanOrEqual(play.x);
    expect(play.x + play.width).toBeLessThanOrEqual(undo.x);
    expect(Math.abs(play.y + play.height / 2 - (undo.y + undo.height / 2))).toBeLessThan(2);
    // From 840 the word shows beside the icon.
    await expect(head.locator(".play-button__word")).toBeVisible();

    await playButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Play" });
    await expect(dialog).toBeVisible();
    await settled(page);
    const viewport = page.viewportSize()!;
    const box = await boxOf(dialog);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThan(viewport.height);
  });
});

test.describe("Play on a phone", () => {
  test.skip(({ hasTouch }) => !hasTouch, "the phone layout");

  test("a bottom sheet, two cards side by side with Skip in view, a result bar at the foot", async ({
    page,
  }) => {
    await openMine(page);
    const viewport = page.viewportSize()!;
    // Below 600 the icon alone, still named Play.
    await expect(page.locator(".play-button__word")).toBeHidden();
    await playButton(page).tap();

    const sheet = page.getByRole("dialog", { name: "Play" });
    await expect(sheet).toBeVisible();
    await settled(page);
    const box = await boxOf(sheet);
    // Pinned to the bottom edge, full width.
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2);
    expect(Math.round(box.width)).toBe(viewport.width);

    // The radio itself is drawn over by its card: tap the card, as a thumb would.
    await page.locator("label", { hasText: "King of the hill" }).tap();
    await expect(page.getByRole("radio", { name: /King of the hill/ })).toBeChecked();
    await page.getByRole("button", { name: "Start", exact: true }).tap();
    await settled(page);

    const [left, right] = await page.getByRole("button", { name: /^Pick / }).all();
    const a = await boxOf(left!);
    const b = await boxOf(right!);
    // Side by side and whole on the screen, with Skip below them, also on it.
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    for (const card of [a, b]) {
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
    }
    const skip = await boxOf(page.getByRole("button", { name: /^Skip/ }));
    expect(skip.y).toBeGreaterThan(a.y + a.height);
    expect(skip.y + skip.height).toBeLessThanOrEqual(viewport.height);

    // Three cards on the hill: two duels, each taken once the last has settled.
    await page
      .getByRole("button", { name: /^Pick / })
      .first()
      .tap();
    await expect(page.getByRole("heading", { name: "Duel 2 of 2" })).toBeVisible();
    await settled(page);
    await page
      .getByRole("button", { name: /^Pick / })
      .first()
      .tap();
    await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible();
    await settled(page);
    const bar = await boxOf(page.locator(".result-view__bar"));
    expect(Math.abs(bar.y + bar.height - viewport.height)).toBeLessThan(2);
    // On somebody else's list Apply is named for where the result goes.
    const apply = await boxOf(page.locator(".result-view__apply"));
    // Apply stretches across the bar, first.
    expect(apply.width).toBeGreaterThan(viewport.width / 2);
  });
});
