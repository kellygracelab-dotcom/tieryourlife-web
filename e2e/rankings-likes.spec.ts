import { expect, test } from "@playwright/test";
import { list } from "./fixtures";
import { signIn } from "./signedIn";

/** A ranking as the proxy answers it (CONTRACT K1). */
const ranking = (uid: string, name: string, extra: Record<string, unknown> = {}) => ({
  uid,
  authorName: name,
  authorPhotoUrl: null,
  arrangement: [1, 0, null],
  rows: [[1], [0]],
  tierLabels: [],
  updatedAtMs: 1_700_000_000_000,
  mine: false,
  likedByMe: false,
  ...extra,
});

test("likes somebody's ranking with the thumb and takes the like back; no count, none for one's own", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/lists/follow/u1", (r) =>
    r.fulfill({ json: { following: false, followers: 0 } }),
  );
  const asked: string[] = [];
  await page.route("**/lists/abc/rankings?*", (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({
      json: {
        rankings: [
          ranking("u1", "danylo", { isAuthor: true, arrangement: [0, 1, null] }),
          ranking("u5", "olena", {
            addedCards: [{ title: "Heat", imageUrl: null }],
            allRows: [[3, 1], [0]],
          }),
          ranking("me", "Danylo", { mine: true }),
        ],
        nextCursor: null,
      },
    });
  });
  const likes: string[] = [];
  await page.route("**/lists/abc/rankings/u5/like", async (route) => {
    const method = route.request().method();
    likes.push(method);
    await route.fulfill({ json: { likedByMe: method === "PUT" } });
  });

  await page.goto("/l/abc");
  await expect(page.getByRole("heading", { name: list.title })).toBeVisible();
  await page.getByLabel("More about this list").click();
  await page.getByRole("button", { name: /^Rankings · / }).click();
  const sheet = page.getByRole("dialog", { name: "Rankings" });
  const like = sheet.getByRole("button", { name: "Like olena’s ranking" });
  await expect(like).toHaveAttribute("aria-pressed", "false");
  expect(asked).toEqual(["?withAuthor=1"]);
  // Only somebody else's has a thumb: not the author's, not one's own.
  await expect(sheet.getByRole("button", { name: /^Like / })).toHaveCount(1);

  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => likes).toEqual(["PUT"]);
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => likes).toEqual(["PUT", "DELETE"]);
  await expect(sheet).not.toContainText(/\d+\s+likes?/i);

  // Her ranking shows the card she added, where she put it.
  await sheet.getByRole("button", { name: /^olena/ }).click();
  const board = page.getByRole("region", { name: "olena" });
  await expect(board.getByRole("list", { name: "S" })).toContainText("Heat");
});
