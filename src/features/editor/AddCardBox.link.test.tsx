import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext, type Session } from "../../app/session";
import type { Incoming } from "../../lib/incoming";
import { LinkRefused, type LinkedPicture } from "../../lib/linkPictures";
import { PictureRefused } from "../../lib/pictures";
import { searchAgainAt } from "../../lib/searchLimit";
import { AddCardBox, type LinkKeep, type Upload } from "./AddCardBox";
import { draftForSignIn, forgetDraftForSignIn } from "./draftAfterSignIn";
import type { EditorAction } from "./model";
import type { FindPictures } from "./usePictures";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

function session(signedIn: boolean, signIn = vi.fn<Session["signIn"]>()): Session {
  return {
    account: signedIn ? member : { kind: "guest", uid: "anon" },
    signIn,
    signOut: async () => undefined,
    refresh: () => undefined,
  };
}

const linked = (more: Partial<LinkedPicture> = {}): LinkedPicture => ({
  imageUrl: "https://storage.test/users/u1/pictures/p1",
  pictureId: "p1",
  attribution: { source: "web" },
  credit: null,
  quota: null,
  ...more,
});

const find = vi.fn<FindPictures>(async () => ({
  items: [],
  hasMore: false,
  notices: [],
  rest: false,
}));

function setup({
  signedIn = true,
  link = vi.fn<LinkKeep>(async () => linked()),
  upload = vi.fn<Upload>(),
  signIn,
  incoming = null,
  house = false,
  loadQuota = async () => null,
}: {
  signedIn?: boolean;
  link?: LinkKeep;
  upload?: Upload;
  signIn?: Session["signIn"];
  incoming?: Incoming | null;
  house?: boolean;
  loadQuota?: () => Promise<{ left: number; limit: number; resetsAt: number } | null>;
} = {}) {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  const value = session(signedIn, signIn ? vi.fn(signIn) : undefined);
  const wrap = (children: ReactNode) => (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
  const box = (now: Incoming | null) => (
    <AddCardBox
      items={[]}
      category="film_tv"
      dispatch={dispatch}
      find={find}
      upload={upload}
      link={link}
      incoming={now}
      house={house}
      loadQuota={loadQuota}
    />
  );
  const view = render(wrap(box(incoming)));
  return {
    dispatch,
    link,
    upload,
    session: value,
    hand: (now: Incoming) => view.rerender(wrap(box(now))),
  };
}

const field = () => screen.getByRole("textbox", { name: "Add a card" });
const pasteLink = (url: string) =>
  fireEvent.change(field(), {
    target: { value: url },
    nativeEvent: { inputType: "insertFromPaste" },
  });
const draft = () => screen.getByRole("group", { name: /Picture from/ });
const nameField = () => within(draft()).getByRole("textbox", { name: "Name" });

afterEach(() => {
  vi.useRealTimers();
  forgetDraftForSignIn();
});

describe("a picture's link in the add field", () => {
  it("opens a draft card that checks the picture, then adds it named, its page on it", async () => {
    let answer: (picture: LinkedPicture) => void = () => undefined;
    const link = vi.fn<LinkKeep>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { dispatch } = setup({ link });
    pasteLink("https://img.test/dune.jpg");
    expect(draft()).toHaveTextContent("Picture from a link");
    // The catalogues are not asked for an address.
    expect(screen.queryByRole("group", { name: "Suggestions" })).toBeNull();
    expect(within(draft()).getByRole("status")).toHaveTextContent("Checking the picture…");
    expect(within(draft()).getByRole("button", { name: "Add card" })).toBeDisabled();
    expect(draft()).toHaveTextContent("from img.test");
    await vi.waitFor(() => expect(link).toHaveBeenCalledWith({ url: "https://img.test/dune.jpg" }));
    expect(find).not.toHaveBeenCalled();
    act(() => answer(linked()));
    await vi.waitFor(() => expect(within(draft()).queryByRole("status")).toBeNull());
    expect(draft().querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.test/users/u1/pictures/p1",
    );
    // Ready, but nameless: not yet.
    expect(within(draft()).getByRole("button", { name: "Add card" })).toBeDisabled();
    await userEvent.type(nameField(), "Dune");
    await userEvent.type(
      within(draft()).getByRole("textbox", { name: "Page it’s from" }),
      "https://site.test/dune",
    );
    expect(within(draft()).getByRole("link", { name: "from site.test" })).toHaveAttribute(
      "href",
      "https://site.test/dune",
    );
    await userEvent.click(within(draft()).getByRole("button", { name: "Add card" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Dune",
      imageUrl: "https://storage.test/users/u1/pictures/p1",
      pictureId: "p1",
      attribution: { source: "web", link: "https://site.test/dune" },
      drafted: true,
    });
    expect(field()).toHaveValue("");
    expect(screen.queryByRole("group", { name: /Picture from/ })).toBeNull();
  });

  it("adds by Enter in the name, and keeps a page that is not one off the card", async () => {
    const { dispatch } = setup();
    pasteLink("https://img.test/dune.jpg");
    await vi.waitFor(() => expect(within(draft()).queryByRole("status")).toBeNull());
    await userEvent.type(
      within(draft()).getByRole("textbox", { name: "Page it’s from" }),
      "not a page",
    );
    expect(draft()).toHaveTextContent("That doesn’t look like a page address.");
    await userEvent.type(nameField(), "Dune{Enter}");
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Dune",
      imageUrl: "https://storage.test/users/u1/pictures/p1",
      pictureId: "p1",
      attribution: { source: "web" },
      drafted: true,
    });
  });

  it.each([
    ["notAPicture", "That link is a page, not a picture."],
    ["unreachable", "That link doesn’t open."],
    ["tooBig", "That picture is too big."],
    ["refused", "This picture can’t be used here."],
  ] as const)(
    "says why a %s link brought no picture, and offers the name alone",
    async (reason, text) => {
      const { dispatch } = setup({
        link: vi.fn<LinkKeep>(async () => Promise.reject(new LinkRefused(reason))),
      });
      pasteLink("https://img.test/page");
      await vi.waitFor(() => expect(within(draft()).getByRole("alert")).toHaveTextContent(text));
      expect(within(draft()).queryByRole("button", { name: "Add card" })).toBeNull();
      expect(within(draft()).queryByRole("button", { name: "Try again" })).toBeNull();
      const without = within(draft()).getByRole("button", { name: "Add without picture" });
      expect(without).toBeDisabled();
      await userEvent.type(nameField(), "Dune");
      await userEvent.click(without);
      expect(dispatch).toHaveBeenCalledWith({
        type: "addItem",
        title: "Dune",
        imageUrl: null,
        drafted: true,
      });
    },
  );

  it("tries again a picture that did not come through", async () => {
    const link = vi
      .fn<LinkKeep>()
      .mockRejectedValueOnce(new LinkRefused("failed"))
      .mockResolvedValue(linked());
    setup({ link });
    pasteLink("https://img.test/dune.jpg");
    await vi.waitFor(() =>
      expect(within(draft()).getByRole("alert")).toHaveTextContent("didn’t come through"),
    );
    await userEvent.click(within(draft()).getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(within(draft()).queryByRole("alert")).toBeNull());
    expect(within(draft()).getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });

  it("says when pictures from links come again, and offers an upload instead", async () => {
    const retryAt = Date.now() + 2 * 60 * 60 * 1000;
    setup({
      link: vi.fn<LinkKeep>(async () => Promise.reject(new LinkRefused("limit", retryAt))),
    });
    pasteLink("https://img.test/dune.jpg");
    await vi.waitFor(() =>
      expect(within(draft()).getByRole("alert")).toHaveTextContent(
        `More at ${searchAgainAt(retryAt)}.`,
      ),
    );
    expect(within(draft()).getByRole("button", { name: "Upload images" })).toBeInTheDocument();
  });

  it("says a busy picture site is a wait, and turns Try again on at its time", async () => {
    const retryAt = Date.now() + 400;
    const link = vi
      .fn<LinkKeep>()
      .mockRejectedValueOnce(new LinkRefused("busy", retryAt, null))
      .mockResolvedValue(linked());
    setup({ link });
    pasteLink("https://img.test/dune.jpg");
    await vi.waitFor(() =>
      expect(within(draft()).getByRole("status")).toHaveTextContent(
        `The picture’s site is busy. Try again at ${searchAgainAt(retryAt)}.`,
      ),
    );
    // A wait, not an error.
    expect(within(draft()).queryByRole("alert")).toBeNull();
    const again = within(draft()).getByRole("button", { name: "Try again" });
    expect(again).toBeDisabled();
    expect(within(draft()).getByRole("button", { name: "Add without picture" })).toBeDisabled();
    await vi.waitFor(() => expect(again).toBeEnabled(), { timeout: 2_000 });
    await userEvent.click(again);
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(within(draft()).getByRole("button", { name: "Add card" })).toBeInTheDocument(),
    );
    expect(within(draft()).queryByRole("status")).toBeNull();
  });

  it("adds a Commons picture as the catalogue's, with its attribution and no copy", async () => {
    const commons = {
      source: "wikimedia",
      author: "Someone",
      license: "CC BY-SA 4.0",
      link: "https://commons.wikimedia.org/wiki/File:Fuji.jpg",
    };
    const thumb =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fuji.jpg/640px-Fuji.jpg";
    const { dispatch } = setup({
      link: vi.fn<LinkKeep>(async () =>
        linked({ imageUrl: thumb, pictureId: null, attribution: commons }),
      ),
    });
    pasteLink("https://thumb.wikimedia.org/a/ab/Fuji.jpg");
    await vi.waitFor(() => expect(draft().querySelector("img")).toHaveAttribute("src", thumb));
    await userEvent.type(nameField(), "Fuji{Enter}");
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Fuji",
      imageUrl: thumb,
      attribution: commons,
      drafted: true,
    });
  });

  it("asks a guest to sign in for the picture, and keeps the draft through a sign-in that leaves", async () => {
    const link = vi.fn<LinkKeep>();
    const signIn = vi.fn<Session["signIn"]>(async () => ({ kind: "redirecting" }));
    const { dispatch } = setup({ signedIn: false, link, signIn });
    pasteLink("https://img.test/dune.jpg");
    expect(within(draft()).queryByRole("status")).toBeNull();
    await userEvent.type(nameField(), "Dune");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(link).not.toHaveBeenCalled();
    expect(within(draft()).queryByRole("button", { name: "Add card" })).toBeNull();
    await userEvent.click(
      within(draft()).getByRole("button", { name: "Sign in to add the picture" }),
    );
    expect(signIn).toHaveBeenCalled();
    expect(draftForSignIn(window.location.pathname)).toEqual({
      path: window.location.pathname,
      url: "https://img.test/dune.jpg",
      name: "Dune",
      page: "",
    });
    await userEvent.click(within(draft()).getByRole("button", { name: "Add without picture" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Dune",
      imageUrl: null,
      drafted: true,
    });
  });

  it("forgets the kept draft when the sign-in stays on the page", async () => {
    const signIn = vi.fn<Session["signIn"]>(async () => ({ kind: "cancelled" }));
    setup({ signedIn: false, signIn });
    pasteLink("https://img.test/dune.jpg");
    await userEvent.click(
      within(draft()).getByRole("button", { name: "Sign in to add the picture" }),
    );
    await vi.waitFor(() => expect(draftForSignIn(window.location.pathname)).toBeNull());
  });

  it("leaves the draft when the link is taken out of the field", async () => {
    setup();
    pasteLink("https://img.test/dune.jpg");
    expect(draft()).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "Dune" } });
    expect(screen.queryByRole("group", { name: /Picture from/ })).toBeNull();
  });
});

describe("a picture pasted or dropped on the board", () => {
  it("opens a draft for one picture of one's own, which goes up at once", async () => {
    const file = new File(["pixels"], "dune.jpg", { type: "image/jpeg" });
    const upload = vi.fn<Upload>(async () => ({ pictureId: "p2", previewUrl: "blob:dune" }));
    const { dispatch, hand } = setup({ upload });
    hand({ kind: "files", files: [file] });
    expect(draft()).toHaveTextContent("Picture from your device");
    expect(within(draft()).queryByRole("textbox", { name: "Page it’s from" })).toBeNull();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    await vi.waitFor(() =>
      expect(draft().querySelector("img")).toHaveAttribute("src", "blob:dune"),
    );
    await userEvent.type(nameField(), "Dune{Enter}");
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Dune",
      imageUrl: "blob:dune",
      pictureId: "p2",
      drafted: true,
    });
  });

  it("says why a picture of one's own did not go up, and offers again what can be", async () => {
    const file = new File(["pixels"], "dune.jpg", { type: "image/jpeg" });
    const upload = vi
      .fn<Upload>()
      .mockRejectedValueOnce(new PictureRefused("upload"))
      .mockResolvedValue({ pictureId: "p2", previewUrl: "blob:dune" });
    const { hand } = setup({ upload });
    hand({ kind: "files", files: [file] });
    await vi.waitFor(() =>
      expect(within(draft()).getByRole("alert")).toHaveTextContent(
        "dune.jpg could not be uploaded",
      ),
    );
    await userEvent.click(within(draft()).getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });

  it("sends several pictures up at once, each named from its file", async () => {
    const files = ["red_fox.jpg", "arctic_fox.png"].map(
      (name) => new File(["pixels"], name, { type: "image/jpeg" }),
    );
    const upload = vi.fn<Upload>(async (file) => ({
      pictureId: file.name,
      previewUrl: `blob:${file.name}`,
    }));
    const { dispatch, hand } = setup({ upload });
    hand({ kind: "files", files });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "addItem", title: "red fox", imageUrl: "blob:red_fox.jpg", pictureId: "red_fox.jpg" },
      {
        type: "addItem",
        title: "arctic fox",
        imageUrl: "blob:arctic_fox.png",
        pictureId: "arctic_fox.png",
      },
    ]);
  });

  it("opens the draft for a link handed in, its name first", async () => {
    const { hand, link } = setup();
    hand({ kind: "link", url: "https://img.test/dune.jpg" });
    expect(field()).toHaveValue("https://img.test/dune.jpg");
    expect(nameField()).toHaveFocus();
    await vi.waitFor(() => expect(link).toHaveBeenCalled());
  });
});

describe("a pasted list with pictures from links", () => {
  const openPaste = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Paste a list" }));
  };

  it("counts the cards from the catalogue and from links, and says which came without a picture", async () => {
    const link = vi.fn<LinkKeep>(async (ask) =>
      ask.url.includes("page") ? Promise.reject(new LinkRefused("notAPicture")) : linked(),
    );
    const { dispatch } = setup({ link });
    await openPaste();
    fireEvent.change(screen.getByRole("textbox", { name: "Names, one to a line" }), {
      target: { value: "Dune https://img.test/dune.jpg\nHeat https://site.test/page" },
    });
    expect(screen.getByText("0 from the catalogue")).toBeInTheDocument();
    expect(screen.getByText("2 from links")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add 2 cards" }));
    await vi.waitFor(() =>
      expect(screen.getByText("2 cards added. 1 came without a picture:")).toBeInTheDocument(),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "addItem", title: "Heat", imageUrl: null });
    expect(screen.getByText("Heat")).toBeInTheDocument();
    expect(screen.getByText("the link is a page, not a picture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/came without a picture/)).toBeNull();
  });

  it("waits for a busy picture site, says until when, then asks the line again", async () => {
    const retryAt = Date.now() + 400;
    const link = vi
      .fn<LinkKeep>()
      .mockRejectedValueOnce(new LinkRefused("busy", retryAt, null))
      .mockResolvedValue(linked());
    const { dispatch } = setup({ link });
    await openPaste();
    fireEvent.change(screen.getByRole("textbox", { name: "Names, one to a line" }), {
      target: { value: "Dune https://img.test/dune.jpg" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add 1 card" }));
    expect(
      await screen.findByText(`Waiting for the source until ${searchAgainAt(retryAt)}…`),
    ).toHaveAttribute("role", "status");
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(link.mock.calls[1]).toEqual(link.mock.calls[0]);
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "addItem", title: "Dune", pictureId: "p1" }),
      ),
    );
    expect(screen.queryByText(/Waiting for the source/)).toBeNull();
  });

  it("gives a guest's lines with a link their names, and offers the sign-in", async () => {
    const link = vi.fn<LinkKeep>();
    const signIn = vi.fn<Session["signIn"]>(async () => ({ kind: "cancelled" }));
    setup({ signedIn: false, link, signIn });
    await openPaste();
    fireEvent.change(screen.getByRole("textbox", { name: "Names, one to a line" }), {
      target: { value: "Dune https://img.test/dune.jpg" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add 1 card" }));
    await vi.waitFor(() =>
      expect(screen.getByText("sign in to add pictures from links")).toBeInTheDocument(),
    );
    expect(link).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalled();
  });

  it("sends the house's lines with or without a page, and shows today's count and the hint", async () => {
    const { link } = setup({
      house: true,
      loadQuota: async () => ({ left: 42, limit: 50, resetsAt: 9 }),
    });
    await openPaste();
    const text = screen.getByRole("textbox", { name: "Name | picture link | page it’s from" });
    expect(await screen.findByText("42 of 50 pictures left today")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pictures from other sites need the page they’re from. Catalogue and Commons pictures don’t.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(text, {
      target: {
        value: [
          "Dune | https://img.test/dune.jpg | https://site.test/dune",
          "Mango | https://commons.wikimedia.org/wiki/File:Mango.jpg",
          "Heat | https://img.test/heat.jpg |",
        ].join("\n"),
      },
    });
    // Nothing is held back: only the backend knows which pictures need their page.
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add 3 cards" }));
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(3));
    expect(link).toHaveBeenCalledWith({
      url: "https://img.test/dune.jpg",
      link: "https://site.test/dune",
    });
    expect(link).toHaveBeenCalledWith({ url: "https://img.test/heat.jpg" });
  });

  it("names the house's cards copied from another site without their page", async () => {
    const link = vi.fn<LinkKeep>(async (ask) =>
      ask.url.includes("commons")
        ? linked({
            imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Mango.jpg",
            pictureId: null,
            attribution: { source: "wikimedia", author: "Someone" },
          })
        : linked(),
    );
    const { dispatch } = setup({ house: true, link });
    await openPaste();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Name | picture link | page it’s from" }),
      {
        target: {
          value: [
            "Mango | https://commons.wikimedia.org/wiki/File:Mango.jpg |",
            "Heat | https://img.test/heat.jpg",
            "Dune | https://img.test/dune.jpg | https://site.test/dune",
          ].join("\n"),
        },
      },
    );
    await userEvent.click(screen.getByRole("button", { name: "Add 3 cards" }));
    await vi.waitFor(() =>
      expect(screen.getByText("1 needs the page its picture is from:")).toBeInTheDocument(),
    );
    expect(dispatch).toHaveBeenCalledTimes(3);
    const note = screen.getByText("1 needs the page its picture is from:").parentElement!;
    expect(
      within(note)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Heat"]);
    expect(note).toHaveTextContent("3 cards added.");
    expect(note).not.toHaveTextContent("came without a picture");
    expect(note).toHaveTextContent("The list won’t publish without the page.");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/needs the page/)).toBeNull();
  });

  it("does not name a card without its page outside the house", async () => {
    setup({ link: vi.fn<LinkKeep>(async () => linked()) });
    await openPaste();
    fireEvent.change(screen.getByRole("textbox", { name: "Names, one to a line" }), {
      target: { value: "Heat https://img.test/heat.jpg" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add 1 card" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Paste a list" })).toBeEnabled(),
    );
    expect(screen.queryByText(/needs the page/)).toBeNull();
    expect(screen.queryByText(/Pictures from other sites need the page/)).toBeNull();
  });
});
