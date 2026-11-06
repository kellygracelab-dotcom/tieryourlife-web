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
