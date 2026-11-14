import { expect, test, type Page } from "@playwright/test";
import { signIn, writeSignedUser } from "./signedIn";
import { gate, list, mockBackend } from "./fixtures";

const source = {
  ...list,
  itemCount: 20,
  items: Array.from({ length: 20 }, (_, i) => ({
    title: "Film " + i,
    imageUrl: null,
    tierIndex: i === 0 ? 0 : null,
  })),
};
const offer = (page: Page) =>
  page.getByRole("complementary", { name: "Show others how you ranked it?" });

async function visit(page: Page, placed: number, signedIn = false) {
  if (!signedIn) await mockBackend(page);
  await page.route("**/lists/sections", (r) => r.fulfill({ json: { sections: [] } }));
  await page.route("**/lists/abc", (r) => r.fulfill({ json: source }));
  await page.route("**/lists/abc/rankings*", (r) =>
    r.fulfill({ json: { rankings: [], nextCursor: null } }),
  );
  await page.addInitScript(
    ({ source, placed }) => {
      const key = "tyl:draft:" + source.id;
      if (placed && !localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            listId: source.id,
            itemCount: 20,
            updatedAt: source.updatedAt,
            rows: [Array.from({ length: placed }, (_, i) => i), []],
          }),
        );
    },
    { source, placed },
  );
  await page.goto("/l/abc");
  await expect(page.getByRole("heading", { name: source.title })).toBeVisible();
}

test("asks once when the last card is placed, keeps nothing by itself, and not again after reopening", async ({
  page,
}) => {
  await visit(page, 19);
  await expect(page.getByText("19 of 20 placed")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Film 19", exact: true }).click();
  await page.keyboard.press("1");
  await expect(offer(page)).toBeVisible();
  // Two answers, the app's, a guest's first one to sign in: no private copy is made behind the question.
  await expect(offer(page).getByRole("button")).toHaveText(["Sign in to share", "Not now"]);
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await expect(offer(page)).toHaveCount(0);
  await page.goto("/b");
  await expect(page.getByRole("heading", { level: 1, name: "Your lists" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(source.title) })).toHaveCount(0);
  await page.goto("/l/abc");
  await expect(page.getByText("20 of 20 placed")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test("a draft with every card placed gets the offer on its first visit", async ({ page }) => {
  await visit(page, 20);
  await expect(offer(page)).toBeVisible();
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await page.reload();
  await expect(page.getByText("20 of 20 placed")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test("the author's arrangement starts no offer; placing every card of a saved copy does", async ({
  page,
}) => {
  await visit(page, 0);
  await expect(page.getByRole("button", { name: "Author", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(offer(page)).toHaveCount(0);
  const save = page.getByRole("button", { name: "Save author’s list" }).first();
  if (!(await save.isVisible())) await page.getByLabel("More about this list").click();
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/b");
  await page
    .getByRole("link", { name: new RegExp(source.title) })
    .first()
    .click();
  await expect(offer(page)).toHaveCount(0);
  for (let i = 1; i < 19; i++) {
    await page.getByRole("button", { name: "Film " + i, exact: true }).click();
    await page.keyboard.press("1");
  }
  await expect(page.locator(".tier .tile")).toHaveCount(19);
  await expect(offer(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Film 19", exact: true }).click();
  await page.keyboard.press("1");
  await expect(offer(page)).toBeVisible();
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await page.reload();
  await expect(page.locator(".tier .tile")).toHaveCount(20);
  await expect(offer(page)).toHaveCount(0);
});

test("a second tab's sign-in requires a new ranking decision while the reader's GET is pending", async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.route("**/lists/follow/u1", (r) =>
    r.fulfill({ json: { following: false, followers: 0 } }),
  );
  await visit(page, 20, true);
  const show = offer(page).getByRole("button", { name: "Show in Rankings" });
  await expect(show).toBeVisible();
  const sentBy: string[] = [];
  await page.route("**/lists/abc/rankings/mine", async (route) => {
    const token = route.request().headers().authorization!.split(".")[1]!;
    const uid = JSON.parse(Buffer.from(token, "base64url").toString()).sub as string;
    sentBy.push(uid);
    await route.fulfill({
      json: { uid, mine: true, rows: [[0], []], tierLabels: [], arrangement: [], created: true },
    });
  });
  const arrived = gate();
  const release = gate();
  let held = false;
  await page.route("**/lists/abc", async (route) => {
    if (!held) {
      held = true;
      arrived.resolve();
      await release.promise;
    }
    await route.fulfill({ json: source });
  });
  await show.click();
  await arrived.promise;
  const other = await context.newPage();
  try {
    await other.goto("/robots.txt");
    await writeSignedUser(other, {
      uid: "second-reader",
      name: "Second Reader",
      email: "second@example.test",
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => localStorage.getItem('tyl:ranking-offer:["second-reader","abc"]')),
        { timeout: 12000 },
      )
      .toBe("seen");
  } finally {
    release.resolve();
    await other.close();
  }
  await expect(show).toBeEnabled();
  expect(sentBy).toEqual([]);
  await show.click();
  await expect(page.getByText("Your ranking is in the list’s rankings")).toBeVisible();
  expect(sentBy).toEqual(["second-reader"]);
});
