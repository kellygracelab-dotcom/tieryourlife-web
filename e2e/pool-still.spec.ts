import { expect, test, type Page } from "@playwright/test";
import { LIST_ID, list, mockBackend } from "./fixtures";

/*
 * A card carried from the pool over the tiers, back and forth: the pool
 * stands still. It flashed (Danylo, 15.11.2026): over a tier the card left
 * the pool, between two tiers it came back, and every card after it moved,
 * at every crossing.
 */

const TIERS = ["S", "A", "B", "C", "D"];
const COLOURS = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400", "#16a085"];
const pictured = {
  ...list,
  itemCount: 16,
  tiers: TIERS.map((label, n) => ({
    label,
    caption: null,
    colorLight: COLOURS[n]!,
    colorDark: COLOURS[n]!,
  })),
  items: Array.from({ length: 16 }, (_, n) => ({
    title: `Film ${n + 1}`,
    imageUrl: `https://pictures.test/${n + 1}.svg`,
    tierIndex: null,
  })),
};

async function pictureBoard(page: Page) {
  await mockBackend(page);
  await page.route(`**/lists/${LIST_ID}`, (route) => route.fulfill({ json: pictured }));
  await page.route("https://pictures.test/**", (route) => {
    const n = Number(new URL(route.request().url()).pathname.replace(/\D/g, ""));
    const colour = COLOURS[n % COLOURS.length];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="180"><rect width="128" height="180" fill="${colour}"/><circle cx="64" cy="90" r="${20 + n * 2}" fill="#fff"/></svg>`,
    });
  });
  await page.goto(`/l/${LIST_ID}`);
  await expect(page.locator(".pool__items [data-item]")).toHaveCount(16);
  // The pictures in sight drawn before anything is compared.
  await expect
    .poll(() =>
      page
        .locator(".pool__items img")
        .evaluateAll((pictures) =>
          pictures.slice(0, 4).every((one) => (one as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
}

/** A finger as the board hears it: Playwright's touchscreen only taps. */
const finger = (page: Page, type: string, at: { x: number; y: number }, target?: string) =>
  page.evaluate(
    ({ type, at, target }) => {
      const where = target === undefined ? window : document.querySelector(target)!;
      where.dispatchEvent(
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
    },
    { type, at, target },
  );

test("a card carried from the pool over the tiers leaves the pool standing still", async ({
  page,
  hasTouch,
}) => {
  await pictureBoard(page);
  // Two rows of cards in a phone's tray too.
  const expand = page.locator(".pool__expand");
  if (await expand.isVisible()) {
    await expand.click();
    await expect(expand).toHaveAttribute("aria-expanded", "true");
  }
  // The first tier some 220px down, where a phone's one-row head left it: a
  // visitor's head now has its buttons on a row of their own (artboard 13).
  const tierTop = await page
    .locator(".tier")
    .first()
    .evaluate((tier) => tier.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, tierTop - 220));
  const pool = page.locator(".pool__items");
  const card = pool.locator("[data-item]").nth(1);
  const box = (await card.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Each tier's middle, and the middle of the gap under it, where the pointer
  // is over no tier at all. Measured once the card is up: a desktop board
  // moves up a little then, and a gap measured before was the next row.
  // Only the tiers in sight above the pool, which a dock or a tray lies over,
  // and clear of the edge where a carried card scrolls the page.
  const tierRow = (tier: number) => page.locator(`.tier[data-drop="tier:${tier}"]`).boundingBox();
  const first = (await tierRow(0))!;
  const over = { x: first.x + first.width * 0.6, y: first.y + first.height / 2 };

  // Lifted, and over the first tier.
  if (hasTouch) {
    await finger(page, "pointerdown", from, `.pool__items [data-item="${1}"]`);
    await page.waitForTimeout(300);
    await finger(page, "pointermove", over);
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 10 });
  }
  await expect(page.locator(".tile--lifted").first()).toBeVisible();
  await page.waitForTimeout(150);

  const poolTop = (await page.locator(".pool").boundingBox())!.y;
  const stops: { x: number; y: number }[] = [];
  for (const tier of [0, 1, 2]) {
    const row = (await tierRow(tier))!;
    const next = (await tierRow(tier + 1))!;
    const gap = (row.y + row.height + next.y) / 2;
    if (gap > poolTop - 60) break;
    stops.push({ x: over.x, y: row.y + row.height / 2 }, { x: over.x, y: gap });
  }
  // An iPhone's two rows of tray leave one tier and its edge in sight.
  expect(stops.length).toBeGreaterThanOrEqual(2);
  // The gaps are over no tier: the card crosses nothing there.
  for (const gap of stops.filter((_, n) => n % 2 === 1)) {
    const under = await page.evaluate(
      (at) =>
        document
          .elementsFromPoint(at.x, at.y)
          .find((element) => !element.closest(".ghost"))
          ?.closest("[data-drop]")
          ?.getAttribute("data-drop") ?? null,
      gap,
    );
    expect(under).toBeNull();
  }
  if (hasTouch) await finger(page, "pointermove", stops[0]!);
  else await page.mouse.move(stops[0]!.x, stops[0]!.y, { steps: 4 });
  await page.waitForTimeout(150);

  // From here on, nothing in the pool may move, change or be drawn again.
  await pool.evaluate((tray) => {
    // Every frame, not only the stops: the pool flashed in passing too.
    const orderOf = () =>
      [...tray.querySelectorAll("[data-item]")]
        .map((tile) => tile.getAttribute("data-item"))
        .join();
    const order = orderOf();
    const seen = { changes: 0, heights: new Set<number>(), reordered: 0 };
    (window as unknown as { poolSeen: typeof seen }).poolSeen = seen;
    new MutationObserver((records) => (seen.changes += records.length)).observe(tray, {
      childList: true,
      subtree: true,
    });
    const watch = () => {
      seen.heights.add(Math.round(tray.getBoundingClientRect().height));
      if (orderOf() !== order) seen.reordered++;
      requestAnimationFrame(watch);
    };
    watch();
  });
  const still = await pool.screenshot({ animations: "disabled" });
  for (let pass = 0; pass < 2; pass++) {
    for (const stop of pass === 0 ? stops : [...stops].reverse()) {
      if (hasTouch) await finger(page, "pointermove", stop);
      else await page.mouse.move(stop.x, stop.y, { steps: 4 });
      await page.waitForTimeout(80);
      const now = await pool.screenshot({ animations: "disabled" });
      expect(now).toEqual(still);
    }
  }
  const seen = await page.evaluate(() => {
    const { changes, heights, reordered } = (
      window as unknown as {
        poolSeen: { changes: number; heights: Set<number>; reordered: number };
      }
    ).poolSeen;
    return { changes, heights: [...heights], reordered };
  });
  expect(seen.reordered).toBe(0);
  expect(seen.changes).toBe(0);
  expect(seen.heights).toHaveLength(1);

  // Let go over tier S, where the passes ended: placed there, the rest of the pool stays.
  const last = stops[0]!;
  if (hasTouch) {
    await finger(page, "pointermove", last);
    await finger(page, "pointerup", last);
  } else {
    await page.mouse.move(last.x, last.y);
    await page.mouse.up();
  }
  await expect(
    page.getByRole("list", { name: "S", exact: true }).locator("[data-item]"),
  ).toHaveCount(1);
  await expect(pool.locator("[data-item]")).toHaveCount(15);
});
