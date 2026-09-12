import { expect, test, type Page } from "@playwright/test";
import { CODE, LIST_ID, mockBackend } from "./fixtures";

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
});
