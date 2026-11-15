import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";

/**
 * Friends, 16.11: "Removed LOV66 · Undo" stayed on and on. A board's notice
 * goes in about four seconds, or sooner: at the board's next action, at its
 * cross, or pushed aside. The next notice takes its place.
 */
function boardOf(uid: string) {
  return {
    uid,
    title: "Notices " + uid,
    displayMode: "WRAP",
    tiers: ["S", "A", "Pool"].map((label, i) => ({
      uid: label,
      label,
      isPool: i === 2,
      position: i,
    })),
    items: Array.from({ length: 6 }, (_, i) => ({
      uid: "c" + i,
      title: "Card " + i,
      imageUrl: "/favicon.svg",
      tierUid: i < 4 ? "S" : "Pool",
      position: i,
      deletedAt: null,
    })),
  };
}

async function open(page: Page, uid: string) {
  await mockBackend(page);
  await page.route("**/lists/sections", (r) => r.fulfill({ json: { sections: [] } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ key, board }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(board));
    },
    { key: "tyl:board:" + uid, board: boardOf(uid) },
  );
  await page.goto("/b/" + uid);
  await expect(page.locator(".tier [data-item]")).toHaveCount(4);
}

const notices = (page: Page) => page.locator(".snackbar");
const card = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Takes a card off the list by its menu: a mouse double-clicks it, a finger double-taps. */
async function remove(page: Page, name: string, touch: boolean) {
  if (touch) {
    const box = (await card(page, name).boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page
      .getByRole("dialog", { name })
      .getByRole("button", { name: "Remove from list" })
      .tap();
  } else {
    await card(page, name).dblclick();
    await page
      .getByRole("menu", { name })
      .getByRole("menuitem", { name: "Remove from list" })
      .click();
    // Not resting on the notice: a pointer on it holds it.
    await page.mouse.move(2, 2);
  }
  await expect(notices(page)).toHaveCount(1);
  await expect(notices(page)).toContainText(`Removed ${name}`);
}

test("a board's notice goes in about four seconds", async ({ page, hasTouch }) => {
  await open(page, "notice-time");
  await remove(page, "Card 1", hasTouch);
  const shown = Date.now();
  await expect(notices(page)).toHaveCount(0, { timeout: 8000 });
  const stayed = Date.now() - shown;
  expect(stayed).toBeGreaterThan(3000);
  expect(stayed).toBeLessThan(6000);
});

test("the next notice takes the place of the one before, and a press on the board ends it", async ({
  page,
  hasTouch,
}) => {
  await open(page, "notice-next");
  await remove(page, "Card 1", hasTouch);
  await remove(page, "Card 2", hasTouch);
  await expect(notices(page)).not.toContainText("Card 1");
  if (hasTouch) await card(page, "Card 0").tap();
  else await card(page, "Card 0").click();
  await expect(notices(page)).toHaveCount(0, { timeout: 1000 });
});

test("a board's notice closes at its cross, and goes when pushed aside", async ({
  page,
  hasTouch,
  browserName,
}) => {
  await open(page, "notice-swipe");
  await remove(page, "Card 1", hasTouch);
  const cross = notices(page).getByRole("button", { name: "Dismiss" });
  if (hasTouch) await cross.tap();
  else await cross.click();
  await expect(notices(page)).toHaveCount(0, { timeout: 1000 });

  await remove(page, "Card 2", hasTouch);
  const box = (await notices(page).locator(".snackbar__text").boundingBox())!;
  const start = { x: box.x + 10, y: box.y + box.height / 2 };
  if (!hasTouch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y, { steps: 4 });
    // Short of far enough, it stays and follows.
    await expect(notices(page)).toHaveClass(/snackbar--swiped/);
    await page.mouse.move(start.x + 160, start.y, { steps: 6 });
    await page.mouse.up();
  } else if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: start.y }],
      });
    await touch("touchStart", start.x);
    for (let i = 1; i <= 10; i++) await touch("touchMove", start.x + 16 * i);
    await touch("touchEnd");
  } else {
    // WebKit has no way here to move a finger; the iPhone run stops at the cross.
    return;
  }
  await expect(notices(page)).toHaveCount(0, { timeout: 1000 });
});
