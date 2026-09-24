import { expect, test, type Page } from "@playwright/test";
import { CODE, LIST_ID, list, mockBackend } from "./fixtures";

const openList = async (page: Page) => {
  const backend = await mockBackend(page);
  await page.goto(`/l/${LIST_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
  return backend;
};

const tier = (page: Page, label: string) => page.getByRole("list", { name: label });
const card = (page: Page, title: string) => page.getByRole("button", { name: title });

const finish = async (page: Page) => {
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Your ranking is live at")).toBeVisible();
  // A guest is offered an account exactly once, after the link exists.
  await page.getByRole("button", { name: "Keep the link only" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute("href", `/r/${CODE}`);
};

test.describe("ranking a list", () => {
  test.skip(({ hasTouch }) => hasTouch, "the mouse path");

  test("drag a card into a tier with the mouse, finish, get a link", async ({ page }) => {
    const backend = await openList(page);
    await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled();

    const from = await card(page, "Ex Machina").boundingBox();
    const to = await tier(page, "S").boundingBox();
    if (from === null || to === null) throw new Error("board not laid out");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(tier(page, "S").getByRole("button", { name: "Ex Machina" })).toBeVisible();
    await expect(page.getByText("1 of 3 placed")).toBeVisible();

    await card(page, "The Witch").click();
    await page.keyboard.press("2");
    await expect(tier(page, "A").getByRole("button", { name: "The Witch" })).toBeVisible();
    await expect(page.getByText("2 of 3 placed")).toBeVisible();

    await finish(page);
    expect(backend.rankRequests).toHaveLength(1);
    const request = backend.rankRequests[0];
    expect(request?.postDataJSON()).toEqual({ listId: LIST_ID, rows: [[0], [1]] });
    expect(await request?.headerValue("authorization")).toMatch(/^Bearer /);
    await expect.poll(() => backend.takes).toBe(1);
  });
});

test.describe("ranking a list on a phone", () => {
  test.skip(({ hasTouch }) => !hasTouch, "the touch path");

  test("tap a card, tap a tier, finish, get a link", async ({ page }) => {
    const backend = await openList(page);

    await card(page, "Climax").tap();
    await tier(page, "A").tap();
    await expect(tier(page, "A").getByRole("button", { name: "Climax" })).toBeVisible();
    await expect(page.getByText("1 of 3 placed")).toBeVisible();

    await finish(page);
    expect(backend.rankRequests[0]?.postDataJSON()).toEqual({ listId: LIST_ID, rows: [[], [2]] });
  });

  // The pool used to start two screens down: a visitor saw empty tiers and
  // nothing to rank, and every card cost a scroll down and a scroll back.
  test("the cards and the tiers share the first screen, and the rest is one tap a card", async ({
    page,
  }) => {
    await openList(page);
    const screenHeight = page.viewportSize()?.height ?? 0;
    for (const target of [card(page, "Ex Machina"), tier(page, "A")]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(screenHeight);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await card(page, "Ex Machina").tap();
    await expect(page.getByText("Tap a tier to place it")).toBeVisible();
    await page.getByRole("button", { name: "Place Ex Machina in S" }).tap();
    await page.getByRole("button", { name: "Place The Witch in A" }).tap();
    await page.getByRole("button", { name: "Place Climax in A" }).tap();
    await expect(page.getByText("All 3 placed")).toBeVisible();
    await expect(page.getByText("3 of 3 placed")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).tap();
    // Picked again, so the rows offer "Place Climax in …" too: the card itself is the exact name.
    await expect(page.getByRole("button", { name: "Climax", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("1 card left");
  });

  test("the app bar says which list this is once the heading has scrolled away", async ({
    page,
  }) => {
    await mockBackend(page);
    // Two tiers and three cards do not fill a tall phone's screen; twelve tiers scroll.
    const tiers = ["S", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].map((label) => ({
      label,
      caption: null,
      colorLight: "#b03a32",
      colorDark: "#f1948c",
    }));
    await page.route("**/lists/tall1", (route) =>
      route.fulfill({ json: { ...list, id: "tall1", tiers } }),
    );
    await page.goto("/l/tall1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    await expect(page.locator(".top__title")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(page.locator(".top__title")).toHaveText("Every A24 film, ranked");
    await expect(page.locator(".top__title")).toBeVisible();
    await expect(page.locator(".brand__name")).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".top__title")).toHaveCount(0);
    await expect(page.locator(".brand__name")).toBeVisible();
  });

  // Twelve cards do not fit a phone's tray, so it scrolls. A card picked from the
  // middle comes to the start of the tray, and the start is the right edge when
  // the text runs right to left: measured from the left, it went off the screen.
  for (const direction of ["ltr", "rtl"] as const) {
    test(`a card picked from the middle of a long tray comes to its start, ${direction}`, async ({
      page,
    }) => {
      await mockBackend(page);
      const items = Array.from({ length: 12 }, (_, i) => ({
        title: `Film ${i + 1}`,
        imageUrl: null,
        tierIndex: null,
      }));
      await page.route("**/lists/longlist1", (route) =>
        route.fulfill({ json: { ...list, id: "longlist1", itemCount: items.length, items } }),
      );
      await page.goto("/l/longlist1");
      await expect(page.getByRole("heading", { level: 2 })).toHaveText("12 cards left");
      await page.evaluate((dir) => {
        document.documentElement.dir = dir;
      }, direction);

      // Twelve cards, five to a page: three dots, the first one lit.
      await expect(page.locator(".pool__dot")).toHaveCount(3);
      await expect(page.locator(".pool__dot").first()).toHaveClass(/pool__dot--on/);

      await page.getByRole("button", { name: "Film 6", exact: true }).tap();
      await expect
        .poll(async () => {
          const gap = await page.evaluate(() => {
            const tray = document.querySelector(".pool__items")!.getBoundingClientRect();
            // The picked card is drawn 4% larger; its holder is what is lined up.
            const picked = document
              .querySelector(".tile--selected")!
              .parentElement!.getBoundingClientRect();
            const rtl = document.documentElement.dir === "rtl";
            return rtl ? tray.right - picked.right : picked.left - tray.left;
          });
          return Math.round(gap);
        })
        .toBe(14);
      // The sixth card at the start is the second page, in either direction.
      await expect(page.locator(".pool__dot").nth(1)).toHaveClass(/pool__dot--on/);
      await expect(page.locator(".pool__dot--on")).toHaveCount(1);
    });
  }
});
