import { expect, test, type Locator } from "@playwright/test";
import { LIST_ID, mockBackend } from "./fixtures";
import { startFromScratch } from "./listVersion";

// A browser that has never been here: the tips the other smokes keep away.
test.use({ storageState: { cookies: [], origins: [] } });

/** Whether two boxes on screen share any of it. */
async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const one = await a.boundingBox();
  const two = await b.boundingBox();
  if (one === null || two === null) throw new Error("not laid out");
  return (
    one.x < two.x + two.width &&
    two.x < one.x + one.width &&
    one.y < two.y + two.height &&
    two.y < one.y + one.height
  );
}

test("a newcomer's first tip comes alone, as a strip over the tray on every device, and goes for good", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto(`/l/${LIST_ID}`);
  await startFromScratch(page);
  const tip = page.locator(".tip");
  await expect(tip).toBeVisible();
  await expect(tip.getByRole("status")).toContainText("Start here:");
  // One tip at a time.
  await expect(tip).toHaveCount(1);
  // Pointing at a card of the pool, ringed; the page under it is not covered over.
  const ringed = page.locator(".tip-ring");
  await expect(ringed).toHaveCount(1);
  await expect(ringed).toHaveAttribute("data-tip", "place");
  await expect(page.locator(".scrim")).toHaveCount(0);
  // Never see-through, on its way in either: it lies over the cards and tiers
  // (Designer, 360, 26.11). Its background is solid and its rise does not fade.
  const solid = await tip.evaluate((element) => {
    const style = getComputedStyle(element);
    const rises = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .filter((rule): rule is CSSKeyframesRule => rule instanceof CSSKeyframesRule)
      .filter((rule) => rule.name === "tip-rise");
    return {
      opacity: style.opacity,
      background: style.backgroundColor,
      fades: rises.some((rule) => /opacity/.test(rule.cssText)),
    };
  });
  expect(solid.opacity).toBe("1");
  expect(solid.background).toMatch(/^rgb\(/);
  expect(solid.fades).toBe(false);

  // A thin strip just over the "Cards left" tray, on a phone (Danylo's yes of
  // 25.11.2026) and on a computer too (walkthrough of 25.11, item 4): never a
  // bubble over the card it explains, the pool's count or the field cards are
  // typed into.
  const bubble = await tip.boundingBox();
  if (bubble === null) throw new Error("not laid out");
  expect(bubble.height).toBeLessThanOrEqual(80);
  expect(await overlaps(tip, ringed)).toBe(false);
  expect(await overlaps(tip, page.locator(".ranking .pool__head"))).toBe(false);
  const tray = page.locator(".ranking .pool");
  const docked = await tray.evaluate((pool) => getComputedStyle(pool).position === "fixed");
  const width = page.viewportSize()!.width;
  if (width < 600 || docked) {
    const box = await tray.boundingBox();
    if (box === null) throw new Error("no tray");
    // Over the tray, or over the snackbar of Start from scratch if it is still up over the tray.
    const notice = await page.locator(".snackbar").first().boundingBox();
    const under = Math.min(box.y, notice?.y ?? Infinity);
    const bottom = bubble.y + bubble.height;
    expect(bottom).toBeLessThanOrEqual(under);
    expect(bottom).toBeGreaterThanOrEqual(under - 16);
  }
  // Across a phone's window; a readable width in the middle of a wide one.
  if (width < 600) expect(bubble.width).toBeGreaterThan(width - 24);
  else expect(Math.abs(bubble.x + bubble.width / 2 - width / 2)).toBeLessThanOrEqual(1);

  // While it is up, the pool's standing hint lines step aside: one hint at a time.
  await expect(page.locator(".pool__hint:visible")).toHaveCount(0);

  await tip.getByRole("button", { name: "Got it" }).click();
  await expect(tip).toHaveCount(0);
  await expect(ringed).toHaveCount(0);
  // Then one line stands, the device's own, and none on the card's menu.
  await expect(page.locator(".pool__hint:visible")).toHaveCount(1);
  await expect(page.getByText(/right-click a card/)).toHaveCount(0);
  await page.reload();
  // The version is one's own now, and opens as such.
  await expect(page.locator(".list-head__version")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tip")).toHaveCount(0);
  await expect(page.locator(".pool__hint:visible")).toHaveCount(1);
});
