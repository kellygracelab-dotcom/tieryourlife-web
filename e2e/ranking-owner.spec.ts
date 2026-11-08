import { expect, test } from "@playwright/test";
import { CODE, LIST_ID, gate, list, mockBackend } from "./fixtures";
import { PIXEL, signIn } from "./signedIn";

const items = [
  ...list.items,
  ...Array.from({ length: 22 }, (_, index) => ({ title: `Film ${index + 4}`, tierIndex: 1 })),
].map((item, index) => ({ ...item, imageUrl: `https://posters.example.test/${index}.png` }));

const ranking = {
  code: CODE,
  listId: LIST_ID,
  listAvailable: true,
  createdAt: 0,
  rows: [[1], items.map((_, index) => index).filter((index) => index !== 1)],
  snapshot: { ...list, items },
};

for (const viewer of ["owner", "another account", "guest"] as const) {
  test(`restores a shared ranking without a false identity: ${viewer}`, async ({ page }) => {
    if (viewer === "guest") await mockBackend(page);
    else await signIn(page);
    await page.route("https://posters.example.test/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PIXEL }),
    );

    // The page function embeds this public snapshot before Firebase knows who opened it.
    await page.route(`**/r/${CODE}`, async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        "</head>",
        `<script type="application/json" id="tyl-preload">${JSON.stringify({ kind: "ranking", ranking })}</script></head>`,
      );
      await route.fulfill({ response, body: html });
    });
    const auth = gate();
    const permission = gate();
    const requested = gate();
    await page.route("**/identitytoolkit.googleapis.com/**/accounts:lookup?*", async (route) => {
      await auth.promise;
      await route.fallback();
    });
    await page.route(`**/api/rank/${CODE}`, async (route) => {
      expect(route.request().headers().authorization).toBeTruthy();
      requested.resolve();
      await permission.promise;
      await route.fulfill({ json: { ...ranking, yours: viewer === "owner" } });
    });
    // Sample painted DOM from boot, including frames between Playwright assertions.
    await page.addInitScript(() => {
      const frames = new Set<string>();
      Object.assign(window, { rankingFrames: frames });
      function frame() {
        const board = document.querySelector(".ranking--read .board");
        const label = board?.getAttribute("aria-label") ?? "";
        const by = document.querySelector(".list-head__meta")?.textContent ?? "";
        const actions = document.querySelector(".ranking__side")?.textContent ?? "";
        frames.add([label, by, actions].join("|"));
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await page.goto(`/r/${CODE}`);
    const card = page.getByRole("button", { name: "The Witch", exact: true });
    await expect(card).toBeVisible();
    const artLoaded = () =>
      card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    await expect.poll(artLoaded).toBe(true);
    await expect(page.locator(".board [data-item]")).toHaveCount(25);
    if (viewer !== "guest") {
      const tile = await card.elementHandle();
      const start = await card.boundingBox();
      const download = page.getByRole("button", { name: "Download image" });
      const downloadStart = await download.boundingBox();
      const neutral = async () => {
        await expect(page.locator(".list-head__meta")).not.toContainText(/ranked by/i);
        await expect(
          page.getByRole("button", { name: /Visitor’s ranking|^Mine$|^Edit$/ }),
        ).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Rank this list" })).toHaveCount(0);
        expect(await tile!.evaluate((el) => el.isConnected)).toBe(true);
      };
      await neutral();
      auth.resolve();
      await requested.promise;
      await neutral();
      permission.resolve();
      await expect(page.locator(".list-head__meta")).toContainText(
        viewer === "owner" ? "ranked by you" : "ranked by a visitor",
      );
      expect(await tile!.evaluate((el) => el.isConnected)).toBe(true);
      const end = await card.boundingBox();
      expect(Math.abs(end!.y - start!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs((await download.boundingBox())!.y - downloadStart!.y)).toBeLessThanOrEqual(1);
    } else {
      auth.resolve();
      permission.resolve();
      await expect(page.locator(".list-head__meta")).toContainText("ranked by a visitor");
    }
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(
      viewer === "owner" ? 1 : 0,
    );
    const frames = await page.evaluate(() =>
      [...(window as unknown as { rankingFrames: Set<string> }).rankingFrames].join("\n"),
    );
    expect(frames).not.toMatch(
      viewer === "owner" ? /visitor|Rank this list/i : /ranked by you|Your ranking|\bEdit\b/i,
    );
    await page.reload();
    await expect(page.locator(".list-head__meta")).toContainText(
      viewer === "owner" ? "ranked by you" : "ranked by a visitor",
    );
    await expect(page.locator(".board [data-item]")).toHaveCount(25);
    await expect.poll(artLoaded).toBe(true);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(
      viewer === "owner" ? 1 : 0,
    );
    if (viewer === "owner") {
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
      await expect(page.getByRole("region", { name: "Your ranking" })).toBeVisible();
    }
  });
}
