import { expect, test, type Page } from "@playwright/test";
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

async function openBoard(page: Page) {
  await mockBackend(page);
  await page.route("**/lists/sections", (r) => r.fulfill({ json: { sections: [] } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ key, board }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(board));
    },
    { key, board },
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

for (const leftovers of ["keep", "pool"]) {
  test("applies a two-card game with the other cards set to " + leftovers, async ({ page }) => {
    await openBoard(page);
    await play(page).click();
    await page.getByRole("button", { name: "Choose cards" }).click();
    const row = page.locator("li.play-row").filter({ hasText: "Tier S" });
    await row.getByRole("button", { name: "Pick cards" }).click();
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
    await expect(page.getByRole("radio", { name: "Leave in their current places" })).toBeChecked();
    if (leftovers === "pool") await page.getByRole("radio", { name: "Move to the pool" }).check();
    expect((await persisted(page)).items.map((i: { tierUid: string }) => i.tierUid)).toEqual(
      board.items.map((i) => i.tierUid),
    );
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.reload();
    const s = page.locator(".tier").first().locator(".tile");
    await expect(s).toHaveCount(leftovers === "keep" ? 3 : 2);
    const names = await s.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(new Set(names.slice(0, 2))).toEqual(new Set(["Card 1", "Card 2"]));
    if (leftovers === "keep") expect(names[2]).toBe("Card 0");
    const pool = page.locator(".pool__items .tile");
    const wanted = board.items.slice(4).map((i) => i.title);
    if (leftovers === "pool") wanted.push("Card 0", "Card 3");
    expect(await pool.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).toEqual(
      wanted,
    );
    await expect(page.locator(".ranking .tile")).toHaveCount(91);
    expect((await persisted(page)).play).toBeNull();
  });
}

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
