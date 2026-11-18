import { expect, test, type Locator, type Page } from "@playwright/test";
import { gate, list } from "./fixtures";
import { FACE_URL, PIXEL, shot, signIn } from "./signedIn";

/*
 * What a signed-in person does, against the mocks in `signedIn.ts`: the
 * proxy, Storage and Firebase Auth answered on this machine. Each flow takes
 * one refusal on the way and the retry after it.
 */

const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

/** A phone's one-row head has no room for the view's button: its choices are in ⋮ (artboard 18). */
const phoneHead = (page: Page) => (page.viewportSize()?.width ?? 0) < 600;

async function showRankedList(page: Page, touch: boolean) {
  if (phoneHead(page)) await press(page.getByLabel("More about this list"), touch);
  else await press(page.getByLabel("Display: Rows"), touch);
  await press(page.getByRole("menuitemradio", { name: /Ranked list/ }), touch);
}

async function expectRankedList(page: Page, touch: boolean) {
  if (!phoneHead(page)) {
    await expect(page.getByLabel("Display: Ranked list")).toBeVisible();
    return;
  }
  await press(page.getByLabel("More about this list"), touch);
  await expect(page.getByRole("menuitemradio", { name: /Ranked list/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
}

async function newBoard(page: Page, touch: boolean, title: string) {
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const field = page.getByRole("textbox", { name: "Title" });
  await field.fill(title);
  await field.press("Enter");
  // An empty pool has the box that brings cards in open on a wide window, behind + Add on a phone.
  if (touch) await press(page.getByRole("button", { name: "Add", exact: true }), touch);
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
  // The header's button beside Play opens the Publish window; its word says what it is.
  const header = page.locator(".list-head .publish-button");
  const word = header.locator(".publish-button__word");
  await press(header, hasTouch);
  const window = page.getByRole("dialog", { name: "Publish “Films I make people watch”" });
  const publishButton = window.getByRole("button", { name: "Publish", exact: true });

  // No section yet: Publish is not greyed out, it says so and sends nothing.
  await press(publishButton, hasTouch);
  await expect(window.getByRole("alert")).toContainText("Pick a section first.");
  expect(account.publishes).toHaveLength(0);
  await press(window.getByRole("radio", { name: "Film & TV" }), hasTouch);
  await expect(window.getByText("Pick a section first.")).toHaveCount(0);

  // The first try is refused: said in words, Publish stays, nothing kept.
  // (An alert carries its icon's name as text, so the words are looked for in it.)
  account.failNext.set("POST /lists", 503);
  await press(publishButton, hasTouch);
  await expect(
    window
      .getByRole("alert")
      .filter({ hasText: "Could not publish. Nothing was lost. Try again." }),
  ).toBeVisible();
  await expect(publishButton).toBeEnabled();
  expect(account.published.size).toBe(0);

  await press(publishButton, hasTouch);
  // The window goes by itself; said under the board, with View; the header says Published.
  await expect(window).toHaveCount(0);
  await expect(page.locator(".snackbar")).toContainText("Published");
  await expect(page.locator(".snackbar").getByRole("button", { name: "View" })).toBeVisible();
  await expect(word).toHaveText("Published");
  expect(account.publishes[0]).toMatchObject({
    title: "Films I make people watch",
    category: "film_tv",
  });
  // Under the author's name: nothing asks to hide it any more.
  expect(account.publishes[0]).not.toHaveProperty("anonymous");
  await shot(page, `publish-${hasTouch ? "phone" : "desktop"}`);

  // A change on the board puts the published copy behind; the header's Update sends it at once.
  await showRankedList(page, hasTouch);
  await expect(word).toHaveText("Update");
  await press(header, hasTouch);
  await expect(page.locator(".snackbar")).toContainText("Updated");
  await expect(word).toHaveText("Published");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(account.calls).toContain("POST /lists/L1");

  // The account's own run keeps the id: the list is still among this account's.
  await expect
    .poll(() => [...account.boards.values()].find((b) => b.title === "Films I make people watch"))
    .toMatchObject({ body: { publishedId: "L1" } });

  // Published opens the window with the link, and Take it down there asks first.
  await press(header, hasTouch);
  const out = page.getByRole("dialog", { name: "Films I make people watch" });
  await expect(out.getByRole("link", { name: "See it in Community" })).toHaveAttribute(
    "href",
    "/l/L1",
  );
  await press(out.getByRole("button", { name: "Take it down" }), hasTouch);
  const ask = page.getByRole("group", { name: "Take Films I make people watch down?" });
  await press(ask.getByRole("button", { name: "Take it down" }), hasTouch);
  await expect(page.getByText("Unpublished. The link no longer works.")).toBeVisible();
  await expect(out).toHaveCount(0);
  await expect(word).toHaveText("Publish");
  expect(account.calls).toContain("DELETE /lists/L1");
  expect(account.published.size).toBe(0);
});

test("asks an untitled list's name with the hint right under the field (QA 34)", async ({
  page,
  hasTouch,
}) => {
  await signIn(page);
  await newBoard(page, hasTouch, "");
  await press(page.locator(".list-head .publish-button"), hasTouch);
  const window = page.getByRole("dialog", { name: "Publish your list" });
  const field = await window.getByRole("textbox", { name: "Name" }).boundingBox();
  const hint = await window.getByText(/People find lists by name/).boundingBox();
  expect(hint!.y - (field!.y + field!.height)).toBeLessThan(24);
});

test("publishes from the board's header, and View opens what others see", async ({
  page,
  hasTouch,
}) => {
  const account = await signIn(page);
  await newBoard(page, hasTouch, "Films from the header");
  const publish = page.locator(".list-head .publish-button");
  // A section chosen and the window closed without publishing: it is kept.
  await press(publish, hasTouch);
  const window = page.getByRole("dialog", { name: "Publish “Films from the header”" });
  await press(window.getByRole("radio", { name: "Film & TV" }), hasTouch);
  await press(window.getByRole("button", { name: "Cancel" }), hasTouch);
  await expect(window).toHaveCount(0);
  expect(account.publishes).toHaveLength(0);

  // Opened again, the window has it chosen, and Publish sends the list.
  await press(publish, hasTouch);
  await expect(window.getByRole("radio", { name: "Film & TV" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await press(window.getByRole("button", { name: "Publish", exact: true }), hasTouch);
  const said = page.locator(".snackbar");
  await expect(said).toContainText("Published");
  await expect(window).toHaveCount(0);
  expect(account.publishes).toHaveLength(1);
  await press(said.getByRole("button", { name: "View" }), hasTouch);
  await expect(page).toHaveURL(/\/l\/L1$/);
});

test("keeps local edits after PUBLICATION_CHANGED and retries the same publication", async ({
  page,
  hasTouch,
}) => {
  const account = await signIn(page);
  await newBoard(page, hasTouch, "Festival films");
  const header = page.locator(".list-head .publish-button");
  await press(header, hasTouch);
  const window = page.getByRole("dialog", { name: "Publish “Festival films”" });
  await press(window.getByRole("radio", { name: "Film & TV" }), hasTouch);
  await press(window.getByRole("button", { name: "Publish", exact: true }), hasTouch);
  await expect(page.locator(".snackbar")).toContainText("Published");

  // A change on the board, sent while the list changed on the backend.
  await showRankedList(page, hasTouch);
  await expect(header.locator(".publish-button__word")).toHaveText("Update");
  let refusedBody: unknown;
  await page.route(
    "**/lists/L1",
    async (route) => {
      refusedBody = route.request().postDataJSON();
      return route.fulfill({
        status: 409,
        json: {
          code: "PUBLICATION_CHANGED",
          error: "The list changed while publishing. Try again.",
        },
      });
    },
    { times: 1 },
  );
  // Update goes from the header at once; refused, the window opens on what was said.
  await press(header, hasTouch);
  const out = page.getByRole("dialog", { name: "Festival films" });
  await expect(
    out.getByRole("alert").filter({
      hasText:
        "The published list changed during the update. Your edits are saved on this device. Try publishing again.",
    }),
  ).toBeVisible();
  await expect(out.getByText("Changes not published yet")).toBeVisible();
  await expect(out.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
  expect(refusedBody).toMatchObject({ title: "Festival films" });
  expect(refusedBody).not.toHaveProperty("anonymous");

  await page.reload();
  await expectRankedList(page, hasTouch);
  await expect(header.locator(".publish-button__word")).toHaveText("Update");
  await press(header, hasTouch);
  await expect(page.locator(".snackbar")).toContainText("Updated");
  expect(account.published.size).toBe(1);
  expect(account.published.get("L1")).toEqual(refusedBody);
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
  await press(page.getByRole("link", { name: "Following", exact: true }), hasTouch);
  await expect(page).toHaveURL("/following");
  const strip = page.getByRole("navigation", { name: "Following" });
  await expect(strip.getByRole("link", { name: "Olena M." })).toBeVisible();
  await expect(strip.getByRole("link", { name: "Mira" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(list.title) }).first()).toBeVisible();

  await press(strip.getByRole("link", { name: "Manage" }), hasTouch);
  await expect(page).toHaveURL("/following/manage");
  await expect(page.getByRole("heading", { name: "People · 2" })).toBeVisible();
  await shot(page, `following-${hasTouch ? "phone" : "desktop"}`);
  const olena = page.getByRole("listitem").filter({ hasText: "Olena M." });

  // A refusal puts the row back as it was and says so; the row never leaves the page.
  account.failNext.set("DELETE /lists/follow/u2", 503);
  // Under a pointer, Following reads Unfollow: the pressed state is what says it.
  await press(olena.getByRole("button", { pressed: true }), hasTouch);
  await expect(page.getByRole("status")).toContainText("Couldn’t unfollow. Try again.");
  await expect(olena.getByRole("button", { pressed: true })).toBeVisible();
  expect(account.followed.map((person) => person.uid)).toEqual(["u2", "u3"]);

  await press(olena.getByRole("button", { pressed: true }), hasTouch);
  await expect(olena.getByRole("button", { name: "Follow", pressed: false })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Unfollowed Olena M.");
  expect(account.followed.map((person) => person.uid)).toEqual(["u3"]);

  // Back on the tab, the strip is read again.
  await press(page.getByRole("link", { name: "Navigate back" }), hasTouch);
  await expect(page).toHaveURL("/following");
  await expect(strip.getByRole("link", { name: "Mira" })).toBeVisible();
  await expect(strip.getByRole("link", { name: "Olena M." })).toHaveCount(0);
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
                label: "Unranked",
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
    // Placed in the circle first, then cut on the device; the middle square will do.
    const placing = page.getByRole("dialog", { name: "Place your face" });
    await press(placing.getByRole("button", { name: "Use this" }), hasTouch);
    await expect(placing).toBeHidden();
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
  // The header shows the face at once; the account's copy follows a moment later.
  await expect.poll(() => account.photoUrl).toBe(FACE_URL);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("header img.face")).toHaveAttribute("src", FACE_URL);

  // Switching the back-up off asks first, and goes off only once the account's copy is gone.
  const backUp = page.getByLabel(/Back up my lists/);
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
  await expect(page.getByLabel(/Back up my lists/)).not.toBeChecked();
  expect(account.calls.filter((call) => call.startsWith("PUT /boards")).length).toBe(puts);
});

test("reopens illustrated lists from Community and Following and returns to the same feed", async ({
  page,
}) => {
  const art = "https://posters.example.test/cover.png";
  const illustrated = {
    ...list,
    coverImageUrl: art,
    items: list.items.map((item) => ({ ...item, imageUrl: art })),
  };
  await signIn(page, {
    followed: [{ uid: list.authorUid, name: list.authorName, photoUrl: null }],
    followedLists: [illustrated],
  });
  await page.route(art, (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
  await page.route(
    (url) => url.pathname.endsWith("/lists"),
    (route) =>
      route.fulfill({ json: { lists: [illustrated], nextCursor: null, followingNobody: false } }),
  );
  await page.route(`**/lists/${list.id}`, (route) => route.fulfill({ json: illustrated }));
  const loaded = (image: Locator) =>
    expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
  for (const path of ["/", "/following"]) {
    await page.goto(path);
    const link = page.locator(`.list-card__main[href="/l/${list.id}"]`).first();
    for (let visit = 0; visit < 2; visit++) {
      await expect(link).toBeVisible();
      await loaded(link.locator("img").first());
      await link.click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
      await loaded(page.getByRole("button", { name: "Ex Machina", exact: true }).locator("img"));
      await page.goBack();
      await expect(page).toHaveURL(path);
      await expect(link).toBeVisible();
    }
  }
});

test("restores favourites without labelling an account's boards as device-only", async ({
  page,
  hasTouch,
}) => {
  await signIn(page);
  await newBoard(page, hasTouch, "Weekend films");
  await page.goto("/b");
  // The star is shown only on favourites (artboard 42): a list becomes one from its menu.
  await press(page.getByRole("button", { name: "More for Weekend films" }), hasTouch);
  await press(page.getByRole("menuitem", { name: "Add to favourites" }), hasTouch);
  const favourite = page.getByRole("button", { name: /Remove Weekend films from favourites/ });
  await expect(favourite).toHaveAttribute("aria-pressed", "true");
  const auth = gate();
  await page.route("**/identitytoolkit.googleapis.com/**/accounts:lookup?*", async (route) => {
    await auth.promise;
    await route.fallback();
  });
  await page.reload();
  await expect(favourite).toBeVisible();
  await expect(page.getByText(/on this device only/)).toHaveCount(0);
  const lookedUp = page.waitForResponse((response) => response.url().includes("accounts:lookup"));
  auth.resolve();
  await lookedUp;
  await expect(page.getByText(/on this device only/)).toHaveCount(0);
  await expect(favourite).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Open Weekend films" }).click();
  await expect(page.getByRole("heading", { name: "Weekend films" })).toBeVisible();
  await page.goBack();
  await expect(favourite).toBeVisible();
});

test("uploads a cover from the board settings and keeps the owner's photo after reopening", async ({
  page,
  hasTouch,
}) => {
  const account = await signIn(page);
  await newBoard(page, hasTouch, "A cover of my own");
  const boardUrl = page.url();
  const settings = async () => {
    await press(page.getByLabel("More about this list"), hasTouch);
    await press(page.getByRole("button", { name: "Cover", exact: true }), hasTouch);
  };
  await settings();
  const choose = page.getByRole("button", { name: "A photo from the gallery" });
  const select = async (name: string, mimeType: string, buffer: Buffer) => {
    const picking = page.waitForEvent("filechooser");
    await press(choose, hasTouch);
    await (await picking).setFiles({ name, mimeType, buffer });
  };
  await select("notes.txt", "text/plain", Buffer.from("test"));
  await expect(page.getByRole("alert")).toContainText("notes.txt");
  await select("poster.png", "image/png", PIXEL);
  // A photo of one's own as the cover opens Adjust cover at once (cover focus, 15.11.2026); ✕ keeps the middle.
  const adjust = page.getByRole("dialog", { name: "Adjust cover" });
  await expect(adjust).toBeVisible();
  await press(adjust.getByRole("button", { name: "Cancel" }), hasTouch);
  await expect(adjust).toBeHidden();
  const cover = page.locator(".board-settings__cover-frame img").filter({ visible: true });
  // The cover of one picture is shown cut by its focus: its frame carries the class.
  const thumb = page.locator(".board-settings__cover-frame img");
  await expect(thumb.last()).toHaveAttribute("src", /^blob:/);
  const src = await thumb.last().getAttribute("src");
  await expect
    .poll(
      () =>
        [...account.boards.values()].find((b) => b.title === "A cover of my own")?.body
          .coverPictureId,
    )
    .toBeTruthy();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.url()).toBe(boardUrl);
  const reads: string[] = [];
  await page.route("**/firebasestorage.googleapis.com/**", async (route) => {
    const request = route.request();
    if (!request.url().includes("alt=media")) return route.fallback();
    const auth = await request.headerValue("authorization");
    const range = await request.headerValue("range");
    if (!auth || !range || new URL(request.url()).searchParams.has("token")) {
      reads.push("unauthorized");
      return route.fulfill({ status: 403 });
    }
    reads.push("sdk");
    return route.fulfill({ body: PIXEL, contentType: "image/png" });
  });
  // A previous Web release persisted the token-bearing preview URL. Reopen those exact local bytes.
  const seeded = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key);
      if (!raw?.includes("A cover of my own") || !raw.includes("coverPictureId")) continue;
      const board = JSON.parse(raw);
      if (!board.coverImageUrl?.includes("users%2F")) continue;
      board.coverImageUrl += "&token=old-test-token";
      board.coverImageUrls = [board.coverImageUrl];
      board.items[0].imageUrl = board.coverImageUrl;
      board.items[0].pictureId = board.coverPictureId;
      board.items[1].imageUrl = null;
      board.items[1].pictureId = board.coverPictureId;
      localStorage.setItem(key, JSON.stringify(board));
      return true;
    }
    return false;
  });
  expect(seeded).toBe(true);
  await page.reload();
  for (const name of ["Ex Machina", "The Witch"]) {
    const image = page.getByRole("button", { name, exact: true }).locator("img").first();
    await expect(image).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await settings();
  await expect(cover.last()).toHaveAttribute("src", /^blob:/);
  await expect(cover.last()).not.toHaveAttribute("src", src!);
  await expect
    .poll(() => cover.last().evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(reads).toEqual(["sdk"]);
  await expect(page.getByRole("button", { name: /Auto|Reset|Remove cover/ }).first()).toBeVisible();
});
