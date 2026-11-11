import { expect, test, type Page, type Response } from "@playwright/test";
import { device, newBoard, person, signIn } from "./emulated";

/*
 * The account's copy of the boards (/boards in the proxy) against the real
 * code: a board made on one device opens on another, a change comes back, and
 * two devices that changed the same board while apart both keep their cards.
 */

async function addCard(page: Page, name: string) {
  const box = page.getByRole("textbox", { name: "Add a card" });
  await box.fill(name);
  await box.press("Enter");
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

/**
 * The account's answer to this device keeping a board that holds this card:
 * what "backed up" means, asked for before the change that brings it about.
 */
function backedUpWith(page: Page, card: string): Promise<Response> {
  return page.waitForResponse(
    (answer) =>
      answer.request().method() === "PUT" &&
      /^\/boards\/[^/]+$/.test(new URL(answer.url()).pathname) &&
      answer.ok() &&
      (answer.request().postData() ?? "").includes(card),
    { timeout: 30_000 },
  );
}

/** This device's boards with this title on /b, once a visit's back-up run has brought them. */
async function boardsTitled(page: Page, title: string, count: number) {
  const links = page.getByRole("link", { name: new RegExp(title) });
  // Each visit to /b starts a run; the account's boards arrive with it.
  await expect(async () => {
    await page.goto("/b");
    await expect(links).toHaveCount(count, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  return links;
}

test("a board made on one device opens on another, and a change there comes back", async ({
  page,
  browser,
}) => {
  const cy = person("Cy");
  const title = `Synced ramen ${Date.now()}`;
  await signIn(page, cy);
  const kept = backedUpWith(page, "Shoyu");
  await newBoard(page, title, ["Tonkotsu", "Shoyu"]);
  await kept;
  const boardUrl = page.url().replace(/\?.*$/, "");

  // The second device signs in to the same account and finds the board there.
  const phone = await device(browser);
  await signIn(phone, cy);
  await (await boardsTitled(phone, title, 1)).click();
  await expect(phone.getByRole("button", { name: "Tonkotsu", exact: true })).toBeVisible();
  await expect(phone.getByRole("button", { name: "Shoyu", exact: true })).toBeVisible();

  // A card added there goes up, and the first device has it on its next visit.
  const sent = backedUpWith(phone, "Miso");
  await addCard(phone, "Miso");
  await sent;
  await expect(async () => {
    await page.goto(boardUrl);
    await expect(page.getByRole("button", { name: "Miso", exact: true })).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await phone.context().close();
});

test("two devices that changed one board while apart both keep their cards", async ({
  page,
  browser,
}) => {
  const di = person("Di");
  const title = `Apart and together ${Date.now()}`;
  await signIn(page, di);
  const kept = backedUpWith(page, "Comté");
  await newBoard(page, title, ["Comté"]);
  await kept;

  const phone = await device(browser);
  await signIn(phone, di);
  await (await boardsTitled(phone, title, 1)).click();
  await expect(phone.getByRole("button", { name: "Comté", exact: true })).toBeVisible();

  // The laptop loses its connection and changes the board meanwhile.
  await page.context().setOffline(true);
  await addCard(page, "Gouda");

  // The phone changes the same board, and its change reaches the account.
  const sent = backedUpWith(phone, "Brie");
  await addCard(phone, "Brie");
  await sent;

  // Back online, the laptop syncs. The order is the content, so nothing
  // merges: the account's version arrives beside the laptop's as a second
  // board, and neither card is lost.
  await page.context().setOffline(false);
  const boards = await boardsTitled(page, title, 2);
  const hrefs = await boards.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  const seen: string[] = [];
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    seen.push(...(await page.getByRole("button").allInnerTexts()));
  }
  expect(seen).toEqual(expect.arrayContaining(["Gouda", "Brie", "Comté"]));
  await phone.context().close();
});

test("the account carries all 91 participants and the next duel to a second device", async ({
  page,
  browser,
}) => {
  const who = person("Sol");
  const title = "Full board " + Date.now();
  await signIn(page, who);
  const backed = backedUpWith(page, "First participant");
  await newBoard(page, title, ["First participant"]);
  await backed;
  // Seed only the cards, as a batch import on the first device. The game, sync
  // request, independent second login, download and resumed duel use the app.
  const uid = new URL(page.url()).pathname.split("/").at(-1);
  if (!uid) throw new Error("Missing board ID");
  await page.evaluate((boardUid) => {
    const key = "tyl:board@" + localStorage.getItem("tyl:owner") + ":" + boardUid;
    const stored = localStorage.getItem(key);
    if (!stored) throw new Error("Missing saved board");
    const board = JSON.parse(stored);
    const first = board.items[0];
    for (let i = 1; i < 91; i++)
      board.items.push({ ...first, uid: crypto.randomUUID(), title: "Player " + i, position: i });
    board.editedAt = Date.now();
    localStorage.setItem(key, JSON.stringify(board));
  }, uid);
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText("91 cards from " + title)).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const pick = page.getByRole("button", { name: /^Pick / });
  const upload = page.waitForResponse(
    (res) =>
      res.ok() &&
      res.request().method() === "PUT" &&
      new URL(res.url()).pathname === "/boards/" + uid &&
      res.request().postDataJSON()?.play?.history?.length === 1,
  );
  await pick.first().click();
  await expect(page.getByRole("heading", { name: /Duel 2/ })).toBeVisible();
  const next = await pick.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  await page.reload(); // a new visit runs the normal pending sync now
  const response = await upload;
  const saved = response.request().postDataJSON().play;
  expect(saved.count).toBe(91);
  expect(new Set(saved.ids).size).toBe(91);
  const other = await device(browser);
  try {
    await signIn(other, who);
    await (await boardsTitled(other, title, 1)).click();
    await other.getByRole("button", { name: "Play", exact: true }).click();
    await other.getByRole("button", { name: "Resume" }).click();
    await expect(other.getByRole("heading", { name: /Duel 2/ })).toBeVisible();
    expect(
      await other
        .getByRole("button", { name: /^Pick / })
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
    ).toEqual(next);
    const remote = await other.evaluate((boardUid) => {
      const stored = localStorage.getItem(
        "tyl:board@" + localStorage.getItem("tyl:owner") + ":" + boardUid,
      );
      if (!stored) throw new Error("Missing downloaded board");
      return JSON.parse(stored).play;
    }, uid);
    expect(remote.ids).toEqual(saved.ids);
    expect(remote.history).toEqual(saved.history);
  } finally {
    await other.context().close();
  }
});
