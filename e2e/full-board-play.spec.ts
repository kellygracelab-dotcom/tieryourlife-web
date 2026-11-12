import { expect, test, type Locator, type Page } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

const uid = "qa-full-board-play";
const key = "tyl:board:" + uid;
const title = "Local game fixture";
const board = {
  uid,
  title,
  tiers: ["S", "A", "Pool"].map((label, i) => ({
    uid: label,
    label,
    isPool: i === 2,
    position: i,
  })),
  items: Array.from({ length: 91 }, (_, i) => ({
    uid: "c" + i,
    title: "Card " + i,
    imageUrl: "/favicon.svg",
    tierUid: i < 3 ? "S" : i === 3 ? "A" : "Pool",
    position: i,
    deletedAt: null,
  })),
};

async function openBoard(page: Page, fixture = board) {
  await mockBackend(page);
  await page.route("**/lists/sections", (r) => r.fulfill({ json: { sections: [] } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ key, board }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(board));
    },
    { key, board: fixture },
  );
  await page.goto("/b");
  await page
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}
const play = (page: Page) => page.getByRole("button", { name: "Play", exact: true });
const persisted = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);

for (const mode of ["Losers stay", "King of the hill", "Bracket"]) {
  test(mode + " keeps all 91 cards and the same next duel after reloading", async ({ page }) => {
    await openBoard(page);
    await play(page).click();
    await expect(page.getByText("91 cards from " + title)).toBeVisible();
    await page.locator("label.play-game").filter({ hasText: mode }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const picks = page.getByRole("button", { name: /^Pick / });
    await picks.first().click();
    await expect.poll(async () => (await persisted(page)).play?.history?.length).toBe(1);
    await expect(page.getByRole("heading", { name: /Duel 2/ })).toBeVisible();
    const next = await picks.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    const saved = (await persisted(page)).play;
    expect(saved.ids).toHaveLength(91);
    expect(new Set(saved.ids).size).toBe(91);
    await page.reload();
    await play(page).click();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("heading", { name: /Duel 2/ })).toBeVisible();
    expect(
      await picks.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
    ).toEqual(next);
    expect((await persisted(page)).play.history).toEqual(saved.history);
  });
}

/** Card 1 and Card 2 picked by hand in the row named `row`, played to the result. */
async function playTwo(page: Page, row: string) {
  await openBoard(page);
  await play(page).click();
  await page.getByRole("button", { name: "Choose cards" }).click();
  await page
    .locator("li.play-row")
    .filter({ hasText: row })
    .getByRole("button", { name: "Pick cards" })
    .click();
  await page.getByRole("checkbox", { name: "Card 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Card 2", exact: true }).check();
  const next = page.getByRole("button", { name: "Continue" });
  await next.click();
  await next.click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page
    .getByRole("button", { name: /^Pick / })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible();
}

const labels = (tiles: Locator) =>
  tiles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

for (const leftovers of ["keep", "pool"]) {
  test(
    "applies a ranked game with its other ranked cards set to " + leftovers,
    async ({ page }) => {
      await playTwo(page, "Ranked");
      await expect(
        page.getByRole("radio", { name: "Leave in their current places" }),
      ).toBeChecked();
      if (leftovers === "pool") await page.getByRole("radio", { name: "Move to the pool" }).check();
      expect((await persisted(page)).items.map((i: { tierUid: string }) => i.tierUid)).toEqual(
        board.items.map((i) => i.tierUid),
      );
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page.reload();
      await expect(page.locator(".ranking .tile")).toHaveCount(91);
      const ranked = await labels(page.locator(".tier .tile"));
      expect(ranked.filter((name) => name === "Card 1" || name === "Card 2")).toHaveLength(2);
      expect(ranked.filter((name) => name === "Card 0" || name === "Card 3")).toHaveLength(
        leftovers === "keep" ? 2 : 0,
      );
      // The pool was outside the game: it keeps every card it had, the unplayed ranked ones after.
      const wanted = board.items.slice(4).map((i) => i.title);
      if (leftovers === "pool") wanted.push("Card 0", "Card 3");
      expect(await labels(page.locator(".pool__items .tile"))).toEqual(wanted);
      await expect(page.locator(".ranking .tile")).toHaveCount(91);
      expect((await persisted(page)).play).toBeNull();
    },
  );
}

test("orders one tier only: its unplayed card behind, the other tier and the pool untouched", async ({
  page,
}) => {
  await playTwo(page, "Tier S");
  // Nothing outside the played cards moves, so there is nothing to choose.
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.reload();
  await expect(page.locator(".ranking .tile")).toHaveCount(91);
  const [s, a] = [page.locator(".tier").nth(0), page.locator(".tier").nth(1)];
  const names = await labels(s.locator(".tile"));
  expect(new Set(names.slice(0, 2))).toEqual(new Set(["Card 1", "Card 2"]));
  expect(names[2]).toBe("Card 0");
  expect(await labels(a.locator(".tile"))).toEqual(["Card 3"]);
  expect(await labels(page.locator(".pool__items .tile"))).toEqual(
    board.items.slice(4).map((i) => i.title),
  );
});

test("reset requires confirmation and restores pool then tier order after reload", async ({
  page,
}) => {
  await openBoard(page);
  const more = page.locator(".list-head details.menu summary").first();
  const reset = page.getByRole("button", { name: "Return all cards to the pool", exact: true });
  await more.click();
  await reset.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".tier .tile")).toHaveCount(4);
  await more.click();
  await reset.click();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".tier .tile")).toHaveCount(4);
  await more.click();
  await reset.click();
  await page.getByRole("button", { name: "Return to pool", exact: true }).click();
  const expected = [...board.items.slice(4), ...board.items.slice(0, 4)].map((i) => i.title);
  for (let i = 0; i < 2; i++) {
    await expect(page.locator(".pool__items .tile")).toHaveCount(91);
    expect(
      await page
        .locator(".pool__items .tile")
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
    ).toEqual(expected);
    if (i === 0) await page.reload();
  }
  await more.click();
  await expect(reset).toBeDisabled();
});

test("one row fits first, last and selected posters above a classic scrollbar", async ({
  playwright,
  baseURL,
  hasTouch,
  browserName,
}, info) => {
  test.skip(hasTouch || browserName !== "chromium", "desktop browser with classic scrollbars");
  const browser = await playwright.chromium.launch({
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar,FluentOverlayScrollbar"],
  });
  const page = await browser.newPage({ baseURL });
  try {
    await openBoard(page);
    for (const width of [960, 1600]) {
      await page.setViewportSize({ width, height: 950 });
      await page.addStyleTag({
        content: ".pool__items::-webkit-scrollbar { display:block; height:15px }",
      });
      const strip = page.locator(".pool--single .pool__items");
      const cards = strip.locator(".tile");
      for (const card of [cards.first(), cards.last()]) {
        await card.scrollIntoViewIfNeeded();
        await card.click();
        const geometry = await card.evaluate((el) => {
          const parent = el.closest(".pool__items")!;
          const style = getComputedStyle(el);
          const ring = Math.max(
            0,
            parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
          );
          const clip = parent.getBoundingClientRect();
          const tile = el.getBoundingClientRect();
          return {
            scrollbar: clip.height - parent.clientHeight,
            overflow: parent.scrollWidth - parent.clientWidth,
            top: tile.top - ring - clip.top,
            bottom: clip.top + parent.clientHeight - tile.bottom - ring,
          };
        });
        await info.attach("geometry-" + width, {
          body: JSON.stringify(geometry),
          contentType: "application/json",
        });
        expect(geometry.scrollbar).toBeGreaterThanOrEqual(15);
        expect(geometry.overflow).toBeGreaterThan(0);
        expect(geometry.top).toBeGreaterThanOrEqual(0);
        expect(geometry.bottom).toBeGreaterThanOrEqual(0);
      }
      const grip = page.getByRole("separator", { name: /rows/i });
      await grip.focus();
      await grip.press("ArrowUp");
      await expect(grip).toHaveAttribute("aria-valuenow", "2");
      await grip.press("ArrowDown");
      await expect(grip).toHaveAttribute("aria-valuenow", "1");
    }
  } finally {
    await browser.close();
  }
});

test("a guest can reset Mine and reopen it without altering the author's ranking", async ({
  page,
}) => {
  await mockBackend(page);
  await page.addInitScript((list) => {
    const key = "tyl:draft:" + list.id;
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          listId: list.id,
          itemCount: list.items.length,
          updatedAt: list.updatedAt,
          rows: [[1], [0]],
        }),
      );
  }, list);
  await page.goto("/l/" + list.id);
  const mine = page.getByRole("button", { name: "Mine", exact: true });
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: "Return all cards to the pool" }).click();
  await page.getByRole("button", { name: "Return to pool", exact: true }).click();
  await page.reload();
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  const pool = page.locator(".pool__items .tile");
  await expect(pool).toHaveCount(3);
  expect(await pool.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).toEqual([
    "Climax",
    "The Witch",
    "Ex Machina",
  ]);
  await page.getByRole("button", { name: "Theirs", exact: true }).click();
  await expect(page.locator(".tier .tile").first()).toHaveAttribute("aria-label", "Ex Machina");
});

// The picker names the area as the app does: the board, Ranked, or the tier.
const areaTitle: Record<string, string> = {
  "whole board": title,
  "two tiers": "Ranked",
  "one occupied tier": "S",
};

for (const scope of ["whole board", "two tiers", "one occupied tier"]) {
  test("replays the same 16 after reloading a saved sample from " + scope, async ({ page }) => {
    const items = board.items.map((item, i) => ({
      ...item,
      tierUid: scope === "one occupied tier" ? "S" : i < 25 ? "S" : i < 50 ? "A" : "Pool",
    }));
    await openBoard(page, { ...board, items });
    await play(page).click();
    await page.getByRole("button", { name: "Choose cards" }).click();
    if (scope === "two tiers") await page.getByRole("checkbox", { name: /The pool/ }).uncheck();
    if (scope === "one occupied tier") {
      // Everything on a board of one tier; ticking the tier alone only orders it.
      const only = page.getByRole("checkbox", { name: /^Tier S/ });
      await only.uncheck();
      await only.check();
      await expect(page.getByRole("checkbox", { name: /^Everything/ })).not.toBeChecked();
    }
    await page.getByRole("button", { name: "16", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("label.play-game").filter({ hasText: "Bracket" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const pick = page.getByRole("button", { name: /^Pick / }).first();
    await pick.click();
    await expect.poll(async () => (await persisted(page)).play?.history.length).toBe(1);
    const original = (await persisted(page)).play;
    expect(original.ids).toHaveLength(16);
    if (scope === "one occupied tier") {
      expect(original.keepTier).toBe(true);
      expect(original.scope).toEqual(["S"]);
    }
    await page.reload();
    await play(page).click();
    await page.getByRole("button", { name: "Resume" }).click();
    for (let i = 1; i < 15; i++) {
      await expect(page.getByRole("heading", { name: "Duel " + (i + 1) + " of 15" })).toBeVisible();
      await pick.click();
    }
    await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible();
    if (scope === "one occupied tier")
      await expect(page.locator(".result-view__tiers .tier")).toHaveCount(1);
    await page.getByRole("button", { name: "Play again" }).click();
    await expect(page.getByText("16 cards from " + areaTitle[scope])).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await pick.click();
    await expect.poll(async () => (await persisted(page)).play?.ids).toEqual(original.ids);
  });
}
