import { devices, expect, test, type Page } from "@playwright/test";
import { LIST_ID, list, mockBackend } from "./fixtures";

/**
 * QA W48: the stack of notices set each one's bottom inline, which beat the
 * rules that stand a notice above a board's tray or dock, so on a phone the
 * Undo lay over the pool's cards and on a wide window over the dock. A notice
 * stands above the pool, and a second notice above the first.
 */
const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox();
  if (found === null) throw new Error(`${selector} is not laid out`);
  return found;
};

const saveToMine = async (page: Page) => {
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Save to my lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Which ranking to save?" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "The author’s" }).click();
  }
  await expect(page.locator(".snackbar")).toContainText("Saved to your lists.");
};

const openMine = async (page: Page, tiers?: number) => {
  await mockBackend(page);
  if (tiers !== undefined) {
    const many = Array.from({ length: tiers }, (_, i) => ({
      label: `T${i + 1}`,
      caption: null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    await page.route(`**/lists/${LIST_ID}`, (route) =>
      route.fulfill({ json: { ...list, tiers: many } }),
    );
  }
  await page.goto(`/l/${LIST_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await page.waitForFunction(() => document.getAnimations().length === 0);
};

// The notice stands clear of the pool: its bottom edge above the pool's top.
const expectAbove = async (page: Page, pool: string) => {
  await expect
    .poll(async () => {
      const notice = await box(page, ".snackbar");
      const under = await box(page, pool);
      return Math.round(notice.y + notice.height) <= Math.round(under.y);
    })
    .toBe(true);
};

// A second notice is lifted by the first one's height (Snackbar.tsx); the lift
// adds to the place the board's rules give, rather than starting from 16 px.
const expectLiftAdds = async (page: Page) => {
  const before = await box(page, ".snackbar");
  await page
    .locator(".snackbar")
    .evaluate((notice: HTMLElement) => notice.style.setProperty("--snackbar-lift", "60px"));
  const after = await box(page, ".snackbar");
  expect(Math.round(before.y - after.y)).toBe(60);
};

test.describe("a notice over a board", () => {
  test.skip(({ hasTouch, browserName }) => hasTouch || browserName !== "chromium", "two sizes");

  test("stands above the phone's tray, and a second notice higher still", async ({ browser }) => {
    const phone = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await phone.newPage();
    await openMine(page);
    await expect(page.locator(".pool")).toHaveCSS("position", "fixed");
    await saveToMine(page);
    await expectAbove(page, ".pool");

    await expectLiftAdds(page);
    await phone.close();
  });

  test("stands above the dock under the board on a wide window, and a second higher still", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMine(page, 12);
    await expect(page.locator(".ranking")).toHaveClass(/ranking--under/);
    await expect(page.locator(".pool")).toHaveCSS("position", "fixed");
    await saveToMine(page);
    await expectAbove(page, ".pool");
    const dock = await box(page, ".pool");
    const notice = await box(page, ".snackbar");
    // 16 px over the dock, as ranking.css has it.
    expect(Math.round(dock.y - (notice.y + notice.height))).toBe(16);
    // The site's own notice lives outside the board, where --board-cap is not
    // set; it starts where the page's notice does all the same (QA W58).
    const siteX = await page.evaluate(() => {
      const site = document.createElement("div");
      site.className = "snackbar";
      site.textContent = "site";
      document.body.append(site);
      const x = site.getBoundingClientRect().x;
      site.remove();
      return x;
    });
    expect(Math.round(siteX)).toBe(Math.round(notice.x));
    await expectLiftAdds(page);
  });
});
