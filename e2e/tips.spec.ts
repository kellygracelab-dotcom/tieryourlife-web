import { expect, test } from "@playwright/test";
import { LIST_ID, mockBackend } from "./fixtures";
import { startFromScratch } from "./listVersion";

// A browser that has never been here: the tips the other smokes keep away.
test.use({ storageState: { cookies: [], origins: [] } });

test("a newcomer's first tip comes by the first card, stays out of the way, and goes for good", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto(`/l/${LIST_ID}`);
  await startFromScratch(page);
  const tip = page.locator(".tip");
  await expect(tip).toBeVisible();
  await expect(tip.getByRole("status")).toContainText("Start here:");
  // Pointing at a card of the pool, ringed; the page under it is not covered over.
  const ringed = page.locator(".tip-ring");
  await expect(ringed).toHaveCount(1);
  await expect(ringed).toHaveAttribute("data-tip", "place");
  const card = await ringed.boundingBox();
  const bubble = await tip.boundingBox();
  if (card === null || bubble === null) throw new Error("not laid out");
  // Beside the card, never over it.
  expect(bubble.y + bubble.height <= card.y || bubble.y >= card.y + card.height).toBe(true);
  await expect(page.locator(".scrim")).toHaveCount(0);

  if (page.viewportSize()!.width < 600) {
    // A phone: a thin strip across the window just over the "Cards left" tray
    // (Danylo's yes of 25.11.2026), not a bubble over the title or the first card.
    await expect(tip).toHaveClass(/tip--strip/);
    const tray = await page.locator(".ranking .pool").boundingBox();
    if (tray === null) throw new Error("no tray");
    // Over the tray, or over the snackbar of Start from scratch if it is still up over the tray.
    const notice = await page.locator(".snackbar").first().boundingBox();
    const under = Math.min(tray.y, notice?.y ?? Infinity);
    const bottom = bubble.y + bubble.height;
    expect(bottom).toBeLessThanOrEqual(under);
    expect(bottom).toBeGreaterThanOrEqual(under - 16);
    expect(bubble.width).toBeGreaterThan(page.viewportSize()!.width - 24);
    expect(bubble.height).toBeLessThanOrEqual(80);
  } else {
    await expect(tip).not.toHaveClass(/tip--strip/);
  }

  await tip.getByRole("button", { name: "Got it" }).click();
  await expect(tip).toHaveCount(0);
  await expect(ringed).toHaveCount(0);
  await page.reload();
  // The version is one's own now, and opens as such.
  await expect(page.locator(".list-head__version")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tip")).toHaveCount(0);
});
