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
const offer = (page: Page) => page.getByRole("complementary", { name: "Share your ranking?" });

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

test("the seventh of twenty offers a private copy once, including after reopening", async ({
  page,
}) => {
  await visit(page, 6);
  await expect(page.getByText("6 of 20 placed")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Film 6", exact: true }).click();
  await page.keyboard.press("1");
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText("7 of 20");
  await offer(page).getByRole("button", { name: "Keep privately" }).click();
  await expect(offer(page)).toHaveCount(0);
  await page.goto("/b");
  await page
    .getByRole("link", { name: new RegExp(source.title) })
    .first()
    .click();
  await expect(page.locator(".tier .tile")).toHaveCount(7);
  const original = page.getByRole("link", { name: "Original list and rankings" });
  await expect(original).toHaveAttribute("href", "/l/abc?rankings=1");
  await original.click();
  await expect(page.getByRole("dialog", { name: "Rankings" })).toBeVisible();
  await page.goto("/l/abc");
  await expect(page.getByText("7 of 20 placed")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test("an existing draft above the threshold gets the offer on its first visit after upgrade", async ({
  page,
}) => {
  await visit(page, 8);
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText("8 of 20");
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await page.reload();
  await expect(page.getByText("8 of 20 placed")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test("the author's arrangement starts no offer; editing a matching saved copy does", async ({
  page,
}) => {
  await visit(page, 0);
  await expect(page.getByRole("button", { name: "Theirs", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(offer(page)).toHaveCount(0);
  const save = page.getByRole("button", { name: "Save to my lists" }).first();
  if (!(await save.isVisible())) await page.getByLabel("More about this list").click();
  await save.click();
  await page.getByRole("button", { name: "The author’s" }).click();
  await page.goto("/b");
  await page
    .getByRole("link", { name: new RegExp(source.title) })
    .first()
    .click();
  await expect(offer(page)).toHaveCount(0);
  for (let i = 1; i <= 6; i++) {
    await page.getByRole("button", { name: "Film " + i, exact: true }).click();
    await page.keyboard.press("1");
  }
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText("7 of 20");
  await offer(page).getByRole("button", { name: "Keep privately" }).click();
  await page.reload();
  await expect(page.locator(".tier .tile")).toHaveCount(7);
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
  await visit(page, 8, true);
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
