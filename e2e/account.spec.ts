import { expect, test, type Locator, type Page } from "@playwright/test";
import { list } from "./fixtures";
import { FACE_URL, PIXEL, shot, signIn } from "./signedIn";

/*
 * What a signed-in person does, against the mocks in `signedIn.ts`: the
 * proxy, Storage and Firebase Auth answered on this machine. Each flow takes
 * one refusal on the way and the retry after it.
 */

const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

async function newBoard(page: Page, touch: boolean, title: string) {
  await page.goto("/b");
  await page.getByRole("button", { name: "New list" }).first().click();
  const field = page.getByRole("textbox", { name: "Title" });
  await field.fill(title);
  await field.press("Enter");
  // On a narrow window the box that brings cards in waits behind Add, in the pool.
  const add = page.getByRole("button", { name: "Add", exact: true });
  if (await add.isVisible()) await press(add, touch);
  for (const name of ["Ex Machina", "The Witch"]) {
    const box = page.getByRole("textbox", { name: "Add a card" });
    await box.fill(name);
    await box.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

test("publishes a board, sends it again and takes it down, and says when a try failed", async ({
  page,
  hasTouch,
}) => {
  const account = await signIn(page);
  await newBoard(page, hasTouch, "Films I make people watch");
  await press(page.getByLabel("More about this board"), hasTouch);
  await press(page.getByRole("button", { name: "List settings" }), hasTouch);
  await page.getByLabel("Category").selectOption("film_tv");
  const publicSwitch = page.getByRole("switch", { name: "Public" });
  await expect(publicSwitch).toBeEnabled();

  // The first try is refused: said in words, the switch stays off, nothing kept.
  // (An alert carries its icon's name as text, so the words are looked for in it.)
  account.failNext.set("POST /lists", 503);
  await press(publicSwitch, hasTouch);
  await expect(page.getByRole("alert")).toContainText(
    "Could not publish. Nothing was lost. Try again.",
  );
  await expect(publicSwitch).not.toBeChecked();
  expect(account.published.size).toBe(0);

  await press(publicSwitch, hasTouch);
  await expect(page.getByText("Published. Anyone with the link can rank it.")).toBeVisible();
  await expect(publicSwitch).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the list" })).toHaveAttribute("href", "/l/L1");
  expect(account.publishes[0]).toMatchObject({
    title: "Films I make people watch",
    category: "film_tv",
  });
  await shot(page, `publish-${hasTouch ? "phone" : "desktop"}`);

  // A change on the board puts the published copy behind; Update sends it again.
  await page.getByRole("radio", { name: /Ranked list/ }).check();
  await expect(page.getByText("The published copy is behind this board.")).toBeVisible();
  await press(page.getByRole("button", { name: "Update" }), hasTouch);
  await expect(page.getByText("Send this board again, over the same link.")).toBeVisible();
  expect(account.calls).toContain("POST /lists/L1");

  // The account's own run keeps the id: the list is still among this account's.
  await expect
    .poll(() => [...account.boards.values()].find((b) => b.title === "Films I make people watch"))
    .toMatchObject({ body: { publishedId: "L1" } });

  // Taken down from the same switch.
  await press(publicSwitch, hasTouch);
  await expect(page.getByText("Unpublished. The link no longer works.")).toBeVisible();
  await expect(publicSwitch).not.toBeChecked();
  expect(account.calls).toContain("DELETE /lists/L1");
  expect(account.published.size).toBe(0);
});

test("shows the people followed, unfollows from Manage, and brings a row back when that failed", async ({
  page,
  hasTouch,
}) => {
  const account = await signIn(page, {
    followed: [
      { uid: "u2", name: "Olena M.", photoUrl: null },
      { uid: "u3", name: "Mira", photoUrl: null },
    ],
    followedLists: [
      {
        id: list.id,
        title: list.title,
        authorUid: "u2",
        authorName: "Olena M.",
        authorPhotoUrl: null,
        category: list.category,
        itemCount: list.itemCount,
        coverImageUrl: null,
        previewImages: [],
        tierColors: list.tierColors,
        updatedAt: list.updatedAt,
        takeCount: list.takeCount,
      },
    ],
  });
  await page.goto("/");
  await press(page.getByRole("radio", { name: "Following" }), hasTouch);
  await expect(page.getByText("You follow 2 people")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "New from people you follow" }).getByText(list.title).first(),
  ).toBeVisible();

  // With a keyboard on a desk, with a finger on a phone.
  const manage = page.getByRole("button", { name: "Manage" });
  if (hasTouch) {
    await manage.tap();
  } else {
    await manage.focus();
    await page.keyboard.press("Enter");
  }
  const dialog = page.getByRole("dialog", { name: "Following" });
  await expect(dialog).toBeVisible();
  const olena = dialog.getByRole("listitem").filter({ hasText: "Olena M." });
  await shot(page, `following-${hasTouch ? "phone" : "desktop"}`);
  if (!hasTouch) {
    // A modal keeps the keyboard inside: round the links, the buttons and Done, and back.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((box) => box.contains(document.activeElement))).toBe(true);
    }
  }

  account.failNext.set("DELETE /lists/follow/u2", 503);
  await press(olena.getByRole("button", { name: "Unfollow" }), hasTouch);
  await expect(dialog.getByRole("alert")).toContainText("Couldn’t follow — try again.");
  await expect(dialog.getByRole("link", { name: "Olena M." })).toBeVisible();
  expect(account.followed.map((person) => person.uid)).toEqual(["u2", "u3"]);

  await press(olena.getByRole("button", { name: "Unfollow" }), hasTouch);
  await expect(dialog.getByRole("link", { name: "Olena M." })).toHaveCount(0);
  expect(account.followed.map((person) => person.uid)).toEqual(["u3"]);

  // Escape closes it, the focus goes back where it was, and the people are read again.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  if (!hasTouch) await expect(manage).toBeFocused();
  await expect(page.getByText("You follow 1 person")).toBeVisible();
});

test("takes a photo as the face, names a refused one, and switches the back-up off only once the copy is gone", async ({
  page,
  hasTouch,
}) => {
  const account = await signIn(page, {
    boards: new Map([
      [
        "k1",
        {
          uid: "k1",
          revision: 1,
          title: "Albums",
          deleted: false,
          body: {
            title: "Albums",
            displayMode: "WRAP",
            category: "music",
            coverImageUrl: null,
            coverImageUrls: [],
            authorName: null,
            publishedId: null,
            deletedAt: null,
            tiers: [
              {
                uid: "t1",
                position: 0,
                label: "S",
                caption: null,
                colorLight: "#B03A32",
                colorDark: "#F1948C",
                isPool: false,
              },
              {
                uid: "tp",
                position: 1,
                label: "",
                caption: null,
                colorLight: "#000000",
                colorDark: "#FFFFFF",
                isPool: true,
              },
            ],
            items: [],
          },
        },
      ],
    ]),
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");

  // The photo, chosen from the tile the way the device presses it. The file
  // field behind it is the control a keyboard and a screen reader reach.
  await expect(page.getByLabel("A photo from the gallery")).toBeEnabled();
  const choosePhoto = async () => {
    const chooser = page.waitForEvent("filechooser");
    await press(page.locator(".settings__choice--photo"), hasTouch);
    await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: PIXEL });
  };

  account.failNext.set("POST /lists/face/*", 422);
  await choosePhoto();
  await expect(page.getByRole("alert")).toContainText(
    "That picture cannot be your face. Pick another.",
  );
  expect(account.photoUrl).toBeNull();

  await choosePhoto();
  await expect(page.getByRole("button", { name: "Your photo" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(account.photoUrl).toBe(FACE_URL);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("header img.face")).toHaveAttribute("src", FACE_URL);

  // Switching the back-up off asks first, and goes off only once the account's copy is gone.
  const backUp = page.getByLabel(/Back up my boards/);
  await expect(backUp).toBeChecked();
  await press(backUp, hasTouch);
  const confirm = page.getByRole("dialog", { name: "Stop backing up?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();

  account.failNext.set("DELETE /boards/k1", 503);
  await press(confirm.getByRole("button", { name: "Stop and delete" }), hasTouch);
  await expect(confirm.getByRole("alert")).toContainText(
    "The copy could not be deleted, so backup stays on. Try again.",
  );
  await expect(backUp).toBeChecked();
  await shot(page, `backup-failed-${hasTouch ? "phone" : "desktop"}`);

  await press(confirm.getByRole("button", { name: "Stop and delete" }), hasTouch);
  await expect(confirm).toBeHidden();
  await expect(backUp).not.toBeChecked();
  expect(account.boards.get("k1")?.deleted).toBe(true);

  // Kept on the device: after a reload it is still off, and nothing goes up.
  const puts = account.calls.filter((call) => call.startsWith("PUT /boards")).length;
  await page.reload();
  await expect(page.getByLabel(/Back up my boards/)).not.toBeChecked();
  expect(account.calls.filter((call) => call.startsWith("PUT /boards")).length).toBe(puts);
});
