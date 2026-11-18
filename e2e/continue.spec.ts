import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";
import { signIn } from "./signedIn";

const LIST_ID = "a24";
const DRAFT = `tyl:draft:${LIST_ID}`;
const GAME = `play:list:${LIST_ID}`;

/** Somebody else's list begun on this device, a game saved over it; then Your lists. */
async function begin(page: Page) {
  await mockBackend(page);
  await page.addInitScript(
    ({ draft, game, id }) => {
      if (sessionStorage.getItem("begun") !== null) return;
      sessionStorage.setItem("begun", "1");
      const now = Date.now();
      localStorage.setItem(
        draft,
        JSON.stringify({
          listId: id,
          updatedAt: 1,
          itemCount: 10,
          title: "Every A24 film",
          picture: null,
          savedAt: now,
          rows: [[0, 1, 2]],
        }),
      );
      localStorage.setItem(
        game,
        JSON.stringify({
          version: 1,
          savedAt: now,
          game: {
            spec: { kind: "hill", count: 3, seed: 1, refine: false },
            ids: ["0", "1", "2"],
            history: [],
            startedAt: now,
            chosen: { kind: "all" },
          },
        }),
      );
    },
    { draft: DRAFT, game: GAME, id: LIST_ID },
  );
  await page.goto("/b");
  const block = page.getByRole("region", { name: "Continue · 1" });
  await expect(block.getByRole("link", { name: "Resume game" })).toBeVisible();
  return block;
}

const stored = (page: Page) =>
  page.evaluate(
    ([draft, game]) => [localStorage.getItem(draft) !== null, localStorage.getItem(game) !== null],
    [DRAFT, GAME] as const,
  );

/** A finger on the row from its middle to `to` (a share of its width from its start), as a phone sends it. */
async function swipe(page: Page, browserName: string, share: number) {
  const row = page.locator("li[data-started]");
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width / 2;
  const to = box.x + box.width * share;
  if (browserName === "chromium") {
    // A real finger: the page's touch-action decides, as on a phone.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined ? [] : [{ x, y }],
      });
    await touch("touchStart", from);
    for (let i = 1; i <= 8; i++) await touch("touchMove", from + ((to - from) * i) / 8);
    await expect(row.locator(".started__under")).toContainText("Discard");
    await touch("touchEnd");
    return;
  }
  // WebKit here cannot hold a finger and move it; the pointer events a finger sends.
  await row.evaluate(
    (element, { from, to, y }) => {
      const send = (type: string, x: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
          }),
        );
      send("pointerdown", from);
      for (let i = 1; i <= 8; i++) send("pointermove", from + ((to - from) * i) / 8);
      send("pointerup", to);
    },
    { from, to, y },
  );
}

test("Discard my arrangement from the menu takes the list out of Continue; Undo brings it back with its game (#224)", async ({
  page,
  hasTouch,
}) => {
  const block = await begin(page);
  if (hasTouch) await page.getByRole("button", { name: "More for Every A24 film" }).tap();
  else await block.getByText("Every A24 film").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Discard my arrangement/ }).click();
  await expect(block).toHaveCount(0);
  expect(await stored(page)).toEqual([false, false]);
  await expect(page.locator(".snackbar")).toContainText("Arrangement discarded");
  await page.locator(".snackbar").getByRole("button", { name: "Undo" }).click();
  await expect(block.getByRole("link", { name: "Resume game" })).toBeVisible();
  expect(await stored(page)).toEqual([true, true]);
});

test("a begun list swipes aside on a touch screen: back before a third, away past it, with Undo (artboard 45)", async ({
  page,
  hasTouch,
  browserName,
}) => {
  test.skip(!hasTouch, "a finger's gesture; a mouse has the menu");
  const block = await begin(page);
  // A short swipe: the row comes back and nothing is lost.
  await swipe(page, browserName, 0.7);
  await expect(page.locator(".started__under")).toHaveCount(0);
  expect(await stored(page)).toEqual([true, true]);
  // Past a third, towards the start: away.
  await swipe(page, browserName, 0.05);
  await expect(block).toHaveCount(0);
  expect(await stored(page)).toEqual([false, false]);
  await expect(page.locator(".snackbar")).toContainText("Arrangement discarded");
  // A click: after a finger moved by CDP, Chromium makes no click of a later tap anywhere on the page.
  await page.locator(".snackbar").getByRole("button", { name: "Undo" }).click();
  await expect(block.getByRole("link", { name: "Resume game" })).toBeVisible();
  expect(await stored(page)).toEqual([true, true]);
  // Nothing was opened by the finger.
  await expect(page).toHaveURL(/\/b$/);
});

// Shared Continue (18.11.2026): signed in, a list begun on the phone is here,
// its game too; Discard takes it away on the account, Undo puts it back there.
test("a list begun on the phone continues here, and Discard and Undo reach the account", async ({
  page,
}) => {
  const now = Date.now();
  const account = await signIn(page, {
    started: new Map([
      [
        "got",
        {
          listId: "got",
          updatedAt: 5,
          changedAt: now - 60_000,
          listVersion: 7,
          itemCount: 45,
          tierCount: 5,
          title: "Game of Thrones characters",
          picture: null,
          pictures: [],
          category: "film_tv",
          rows: [[3, 7], [1], [], [12], []],
          placed: 4,
          play: {
            kind: "hill",
            count: 3,
            seed: 1,
            refine: false,
            ids: ["0", "2", "4"],
            history: [],
            round: 0,
            startedAt: now - 60_000,
          },
        },
      ],
    ]),
  });
  await page.goto("/b");
  const block = page.getByRole("region", { name: "Continue · 1" });
  await expect(block.getByText("Film & TV · 4 of 45 placed")).toBeVisible();
  await expect(block.getByRole("link", { name: "Resume game" })).toBeVisible();
  await block.getByRole("button", { name: "More for Game of Thrones characters" }).click();
  await page.getByRole("menuitem", { name: /Discard my arrangement/ }).click();
  await expect(block).toHaveCount(0);
  await expect.poll(() => account.started.get("got")?.removed).toBe("discard");
  const gone = account.started.get("got")!.updatedAt;
  await page.locator(".snackbar").getByRole("button", { name: "Undo" }).click();
  await expect(block.getByRole("link", { name: "Resume game" })).toBeVisible();
  await expect.poll(() => account.started.get("got")?.removed).toBeUndefined();
  expect(account.started.get("got")).toMatchObject({ placed: 4, play: { ids: ["0", "2", "4"] } });
  expect(Number(account.started.get("got")!.updatedAt)).toBeGreaterThan(Number(gone));
  expect(account.calls.filter((call) => call.includes("/boards/started/"))).toEqual([
    "DELETE /boards/started/got",
    "PUT /boards/started/got",
  ]);
});
