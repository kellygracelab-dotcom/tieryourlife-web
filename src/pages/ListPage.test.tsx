import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowState } from "../api/community";
import { ApiFailure, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";
import { HIDDEN_KEY } from "../features/community/hidden";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { itemsIn, poolTier, rankedTiers } from "../features/boards/model";
import { boards } from "../features/boards/repository";
import { writeKept } from "../features/ranking/kept";
import { draftKey, loadDraft, saveDraft, scopeOf } from "../features/tierboard/draft";
import { localStorageStore, memoryStore } from "../lib/storage";

const mocks = vi.hoisted(() => ({
  loadList: vi.fn<(id: string) => Promise<PublishedList>>(),
  report: vi.fn<(id: string, request: unknown) => Promise<void>>(),
  republish: vi.fn(),
  unpublish: vi.fn<(id: string) => Promise<void>>(),
  followState: vi.fn<(uid: string) => Promise<FollowState>>(),
  followAuthor: vi.fn<(uid: string) => Promise<unknown>>(),
  unfollowAuthor: vi.fn<(uid: string) => Promise<unknown>>(),
  preloadHidesAuthor: vi.fn<(id: string) => boolean>(() => false),
}));
vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  followState: mocks.followState,
  followAuthor: mocks.followAuthor,
  unfollowAuthor: mocks.unfollowAuthor,
  report: mocks.report,
  unpublish: mocks.unpublish,
  republish: mocks.republish,
  findInCatalogue: vi.fn(async () => []),
  removeRanking: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadList: mocks.loadList,
  preloadHidesAuthor: mocks.preloadHidesAuthor,
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  loadRanking: vi.fn(),
}));

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 2,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 2140,
  tiers: [{ label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" }],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: null },
  ],
};

/** The same list as an author who placed nothing left it. */
const unarranged: PublishedList = {
  ...list,
  items: list.items.map((item) => ({ ...item, tierIndex: null })),
};

const open = (id = "abc") =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/l/${id}`] })} />);

const refuse = (error: ApiError) => mocks.loadList.mockRejectedValueOnce(new ApiFailure(error));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u9",
  displayName: "Reader",
  photoUrl: null,
};

const openAs = (
  account: Session["account"],
  signIn: Session["signIn"] = async () => ({ kind: "cancelled" }),
) => {
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/l/abc"] })} />
    </SessionContext.Provider>,
  );
};

const whose = () => screen.getByRole("group", { name: "Whose arrangement to show" });

/** The menu's lines in their order, the separator as "—". */
const menuLines = () =>
  [...document.querySelectorAll(".list-head .menu__list > li")].map((line) =>
    line.getAttribute("role") === "separator" ? "—" : line.textContent,
  );

let hiddenStore = memoryStore();

beforeEach(() => {
  mocks.loadList.mockReset();
  mocks.report.mockReset();
  mocks.unpublish.mockReset();
  mocks.followState.mockReset();
  mocks.followState.mockResolvedValue({ following: false, followers: 3 });
  mocks.followAuthor.mockReset();
  mocks.followAuthor.mockResolvedValue({ following: true });
  mocks.unfollowAuthor.mockReset();
  mocks.unfollowAuthor.mockResolvedValue({ following: false });
  hiddenStore = memoryStore();
  useHiddenStoreForTests(hiddenStore);
  localStorage.clear();
});

describe("ListPage and a list without its author's name", () => {
  it("asks the network as the account, when the page's copy names nobody", async () => {
    mocks.preloadHidesAuthor.mockReturnValue(true);
    mocks.loadList.mockResolvedValue({ ...list, authorUid: "", authorName: "", anonymous: true });
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    expect(mocks.loadList).toHaveBeenCalledWith("abc", true);
    mocks.preloadHidesAuthor.mockReturnValue(false);
  });

  it("keeps the page's copy for a visitor", async () => {
    mocks.preloadHidesAuthor.mockReturnValue(true);
    mocks.loadList.mockResolvedValue({ ...list, authorUid: "", authorName: "", anonymous: true });
    openAs(null);
    await screen.findByRole("heading", { level: 1 });
    expect(mocks.loadList).toHaveBeenCalledWith("abc", false);
    mocks.preloadHidesAuthor.mockReturnValue(false);
  });
});

describe("ListPage save to my lists", () => {
  it("makes a board of somebody's list, asking whose ranking to keep, and opens it", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    // The head's button and the menu's row are the same flow; the head's is pressed here.
    await screen.findByLabelText("More about this list");
    await userEvent.click(screen.getAllByRole("button", { name: "Save to my lists" })[0]!);
    // The author placed Ex Machina, so there is a choice to make.
    const dialog = screen.getByRole("dialog", { name: "Which ranking to save?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "The author's" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Saved to your lists.")).toBeInTheDocument();

    const [saved] = boards.all();
    expect(saved?.title).toBe("Every A24 film, ranked");
    expect(saved?.category).toBe("film_tv");
    expect(saved?.publishedId).toBeNull();
    const [s] = rankedTiers(saved!);
    expect(itemsIn(saved!, s!.uid).map((item) => item.title)).toEqual(["Ex Machina"]);
    expect(itemsIn(saved!, poolTier(saved!)!.uid).map((item) => item.title)).toEqual(["The Witch"]);

    // Open leads to the new board, which has the list's name and its arrangement.
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    // The board page is a separate chunk; its first load in a test takes a moment.
    expect(await screen.findByText(/1 ranked · 1 in pool/, {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Every A24 film, ranked");
  });
});

describe("ListPage report and hide", () => {
  it("reports a list from the menu, hides it for this person and shows the receipt", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockResolvedValue(undefined);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Hate or harassment" }));
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Also hide everything from danylo" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Report" }));
    expect(mocks.report).toHaveBeenCalledWith("abc", { reason: "hate", note: null });
    const receipt = await screen.findByRole("dialog", { name: "Reported, and hidden for you" });
    // The box was ticked: the receipt does not offer it again.
    expect(within(receipt).queryByRole("button", { name: /hide everything/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "You hid everything from danylo",
    );
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"u1"');

    await userEvent.click(screen.getByRole("button", { name: "Unhide" }));
    expect(whose()).toBeInTheDocument();
    expect(hiddenStore.read(HIDDEN_KEY)).toBeNull();
  });

  it("offers to hide everything from the author on the receipt, as the app does", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockResolvedValue(undefined);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    const receipt = await screen.findByRole("dialog", { name: "Reported, and hidden for you" });
    await userEvent.click(
      within(receipt).getByRole("button", { name: "Also hide everything from danylo" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "You hid everything from danylo",
    );
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"u1"');
  });

  it("names a report that could not be sent and keeps the form", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing was sent");
    expect(screen.getByRole("radio", { name: "Spam or advertising" })).toBeChecked();
  });

  it("asks a guest to sign in before reporting, and opens the form once they have", async () => {
    mocks.loadList.mockResolvedValue(list);
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValue({ kind: "signedIn", switched: false });
    openAs({ kind: "guest", uid: "g1" }, signIn);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    const ask = screen.getByRole("dialog", { name: "Sign in to report" });
    await userEvent.click(within(ask).getByRole("button", { name: "Continue with Google" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("dialog", { name: "Report this list" })).toBeInTheDocument();
  });

  it("lets a guest hide instead of signing in, with an undo in the snackbar", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs({ kind: "guest", uid: "g1" });
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide instead" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
    const snackbar = screen.getAllByRole("status").find((el) => el.className === "snackbar")!;
    expect(snackbar).toHaveTextContent("Hidden for you");
    await userEvent.click(within(snackbar).getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("heading", { level: 2, name: /You hid/ })).toBeNull();
  });

  it("hides from the menu and copies the link", async () => {
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    const menu = within(screen.getByLabelText("More about this list").closest("details")!);
    await userEvent.click(menu.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/l/abc");
    expect(await screen.findByText("Link copied")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Hide this list" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
    expect(screen.getByRole("link", { name: "Go to home" })).toHaveAttribute("href", "/");
  });

  it("offers the device's own share sheet where there is one, and shrugs when it is closed", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    cleanup();

    const share = vi.fn(() => Promise.reject(new DOMException("closed", "AbortError")));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      openAs(member);
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getByLabelText("More about this list"));
      await userEvent.click(screen.getByRole("button", { name: "Share" }));
      expect(share).toHaveBeenCalledWith({ title: list.title, url: "http://localhost:3000/l/abc" });
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });
});

describe("ListPage menu", () => {
  it("has the app's lines in the app's order, the report in the error colour", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    // Save to my lists is the head's button on a wide screen and only a phone's line here.
    // Who else ranked it comes first, the one place the number is said.
    expect(menuLines()).toEqual([
      "Rankings · 2,140",
      "View danylo",
      "Copy link",
      "Save to my lists",
      "Hide this list",
      "—",
      "Report this list",
      "Privacy policy",
    ]);
    expect(screen.getByRole("link", { name: "View danylo" })).toHaveAttribute("href", "/u/u1");
    expect(screen.getByRole("button", { name: "Report this list" })).toHaveClass(
      "menu__action--danger",
    );
    const menu = within(screen.getByLabelText("More about this list").closest("details")!);
    expect(menu.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
    // Hiding everything from the author is on their page and on the report's receipt.
    expect(screen.queryByRole("button", { name: /^Hide everything/ })).toBeNull();
  });

  it("has no author to view on a list that came without the author's uid", async () => {
    mocks.loadList.mockResolvedValue({ ...list, authorUid: "" });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines().slice(0, 2)).toEqual(["Rankings · 2,140", "Copy link"]);
  });
});

describe("ListPage", () => {
  it("puts the count, Undo and Finish in its header while the pool is docked under the board", async () => {
    const had = { width: window.innerWidth, height: window.innerHeight };
    Object.assign(window, { innerWidth: 1600, innerHeight: 900 });
    try {
      mocks.loadList.mockResolvedValue(list);
      open();
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getByRole("button", { name: "Mine" }));
      const article = document.querySelector(".list-page")!;
      expect(article).toHaveClass("list-page--under");
      expect(document.querySelector(".list-head .ranking__bar")).not.toBeNull();
      expect(
        within(document.querySelector<HTMLElement>(".list-head")!).getByRole("button", {
          name: "Finish",
        }),
      ).toBeInTheDocument();

      // Moving the pool does not move the buttons: they stay in the header.
      await userEvent.click(screen.getByRole("button", { name: "Cards beside the board" }));
      expect(article).toHaveClass("list-page--beside");
      expect(document.querySelector(".list-head .ranking__bar")).not.toBeNull();
      expect(document.querySelector(".ranking__side .ranking__bar")).toBeNull();
    } finally {
      Object.assign(window, { innerWidth: had.width, innerHeight: had.height });
    }
  });

  it("shows skeleton rows while the list is on its way", () => {
    mocks.loadList.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByText("Opening the list…")).toBeInTheDocument();
  });

  it("opens on the author's ranking, with the author in the head and the rankings in its menu", async () => {
    mocks.loadList.mockResolvedValue(list);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Every A24 film, ranked",
    );
    const author = screen.getByRole("link", { name: "by danylo" });
    expect(author).toHaveAttribute("href", "/u/u1");
    // How many ranked it is not said in the head: it is a line of the ⋮ menu.
    expect(screen.queryByRole("button", { name: /rankings$/ })).toBeNull();
    expect(document.querySelector(".list-head__lines")).not.toHaveTextContent(/2,140|rankings/);
    // The address is not spelled out any more: one press copies it.
    expect(screen.queryByText(`${window.location.host}/l/abc`)).toBeNull();

    // Theirs has no pool, no tray and no Finish: the author's cards only, where they put them.
    expect(within(whose()).getByRole("button", { name: "Theirs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    expect(within(theirs).getByRole("list", { name: "S" })).toHaveTextContent("Ex Machina");
    expect(theirs).not.toHaveTextContent("The Witch");
    expect(screen.queryByRole("heading", { name: /unranked/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(mocks.loadList).toHaveBeenCalledWith("abc", false);
  });

  it("switches to an empty board of one's own and back, in the phone app's words", async () => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    try {
      mocks.loadList.mockResolvedValue(list);
      open();
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(within(whose()).getByRole("button", { name: "Mine" }));
      expect(within(whose()).getByRole("button", { name: "Mine" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const yours = screen.getByRole("region", { name: "Your ranking" });
      expect(document.querySelector(".list-head")).toHaveTextContent("0 of 2 placed");
      expect(yours).toHaveTextContent("2 cards left");
      // The same cards move between the boards rather than the boards swapping.
      const durations = animate.mock.calls.map(
        ([, options]) => (options as KeyframeAnimationOptions).duration,
      );
      expect(durations).toContain(200);

      await userEvent.click(within(whose()).getByRole("button", { name: "Theirs" }));
      expect(screen.getByRole("region", { name: "Their ranking" })).toHaveTextContent("Ex Machina");
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("opens on Mine where this device has begun a ranking of the list", async () => {
    saveDraft(localStorageStore, scopeOf(list), [[1]]);
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(within(whose()).getByRole("button", { name: "Mine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    expect(document.querySelector(".list-head")).toHaveTextContent("1 of 2 placed");
  });

  it("opens on Mine where this device finished a ranking of the list, and not for an untouched board", async () => {
    // A board only opened leaves empty rows behind: that is no ranking of anybody's.
    saveDraft(localStorageStore, scopeOf(list), [[]]);
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("region", { name: "Their ranking" })).toBeInTheDocument();
    cleanup();

    writeKept(localStorageStore, "abc", { code: "abcdefgh", claimToken: "secret" });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
  });

  it("has no switch where the author arranged nothing, and opens on Mine", async () => {
    mocks.loadList.mockResolvedValue(unarranged);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
  });

  it("stands without an author when the list is editorial", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      authorUid: "85RRieyLyUPCEqHjdYCdxVlWxHx2",
      authorName: "Danylo Petrov",
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/Danylo Petrov/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^by / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();

    // Hiding its author would hide every editorial list; one list can still be hidden or reported.
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(screen.getByRole("button", { name: "Rankings · 2,140" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide this list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report this list" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^View / })).toBeNull();
    expect(screen.queryByText(/Danylo/)).toBeNull();
  });

  it("names the author without a link and offers no Follow when the list came without their uid", async () => {
    mocks.loadList.mockResolvedValue({ ...list, authorUid: "" });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("by danylo")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "by danylo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
  });

  it("has no rankings line in the menu for a list nobody has ranked", async () => {
    mocks.loadList.mockResolvedValue({ ...list, takeCount: 0 });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines()[0]).toBe("View danylo");
    expect(screen.queryByRole("button", { name: /^Rankings/ })).toBeNull();
  });

  it("copies the link with one press of the button in the head, and says so there", async () => {
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    await screen.findByRole("heading", { level: 1 });
    const button = screen.getAllByRole("button", { name: "Copy link" })[0]!;
    expect(button).toHaveClass("list-head__copy");
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/l/abc");
    expect(button).toHaveTextContent("Link copied");
  });
});

/** Two tiers, two cards in S and one in A: room to move a card on Theirs. */
const twoTiers: PublishedList = {
  ...list,
  itemCount: 3,
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: 1 },
    { title: "Climax", imageUrl: null, tierIndex: 0 },
  ],
};

const theirsPressed = () =>
  within(whose()).getByRole("button", { name: "Theirs" }).getAttribute("aria-pressed");
/** The snackbar holding these words, for its Undo: the board's bar has an Undo of its own. */
const snackbar = (words: string) => within(screen.getByText(words).closest(".snackbar")!);

describe("ListPage, starting Mine from Theirs", () => {
  it("copies the author's ranking into Mine on the first move, says so, and Undo goes back", async () => {
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    // Looking is not ranking: nothing is kept for opening Theirs or picking a card on it.
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    await userEvent.click(within(theirs).getByRole("button", { name: "Ex Machina" }));
    expect(within(theirs).getByRole("button", { name: "Ex Machina" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(theirsPressed()).toBe("true");
    expect(localStorage.getItem(draftKey("abc"))).toBeNull();
    expect(screen.getByText("Placing it starts your version from danylo’s.")).toBeInTheDocument();

    // The switch's fill slides across to Mine as the page goes there.
    expect(whose()).not.toHaveClass("whose--mine");
    await userEvent.keyboard("2");
    expect(theirsPressed()).toBe("false");
    expect(whose()).toHaveClass("whose--mine");
    const yours = screen.getByRole("region", { name: "Your ranking" });
    expect(within(yours).getByRole("list", { name: "A" })).toHaveTextContent("The WitchEx Machina");
    expect(within(yours).getByRole("list", { name: "S" })).toHaveTextContent("Climax");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[2], [1, 0]]);

    const said = snackbar("Your version starts from danylo’s ranking");
    await userEvent.click(said.getByRole("button", { name: "Undo" }));
    expect(localStorage.getItem(draftKey("abc"))).toBeNull();
    expect(theirsPressed()).toBe("true");
    expect(
      within(screen.getByRole("region", { name: "Their ranking" })).getByRole("list", {
        name: "S",
      }),
    ).toHaveTextContent("Ex MachinaClimax");
  });

  it("replaces a Mine already begun, says so, and Undo puts the old one back as it was", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    const before = localStorage.getItem(draftKey("abc"));
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    // Begun here, so the page opens on Mine; Theirs is a press away.
    await userEvent.click(within(whose()).getByRole("button", { name: "Theirs" }));

    // The card's menu moves it too.
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    await userEvent.dblClick(within(theirs).getByRole("button", { name: "Climax" }));
    const menu = within(screen.getByRole("menu", { name: "Climax" }));
    expect(menu.queryByRole("menuitem", { name: "Remove from list" })).toBeNull();
    await userEvent.click(menu.getByRole("menuitem", { name: "Move to a tier" }));
    await userEvent.click(
      within(screen.getByRole("menu", { name: "Move to a tier" })).getByRole("menuitem", {
        name: "A",
      }),
    );
    expect(theirsPressed()).toBe("false");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[0], [1, 2]]);

    const said = snackbar("Replaced your version with danylo’s ranking");
    await userEvent.click(said.getByRole("button", { name: "Undo" }));
    expect(localStorage.getItem(draftKey("abc"))).toBe(before);
    expect(theirsPressed()).toBe("true");
    await userEvent.click(within(whose()).getByRole("button", { name: "Mine" }));
    expect(
      within(screen.getByRole("region", { name: "Your ranking" })).getByRole("list", {
        name: "S",
      }),
    ).toHaveTextContent("The Witch");
  });

  it("starts from an arrow key too, and names nobody where the list has no author's name", async () => {
    mocks.loadList.mockResolvedValue({ ...twoTiers, authorName: " " });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Ex Machina" }));
    expect(
      screen.getByText("Placing it starts your version from this ranking."),
    ).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(theirsPressed()).toBe("false");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[2, 0], [1]]);
    expect(screen.getByText("Your version starts from this ranking")).toBeInTheDocument();
  });
});

describe("ListPage author line", () => {
  it("follows the author from the head, and unfollows with an Undo", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(mocks.followState).toHaveBeenCalledWith("u1");
    expect(mocks.followAuthor).toHaveBeenCalledWith("u1");
    const following = screen.getByRole("button", { name: /Following/ });
    expect(following).toHaveAttribute("aria-pressed", "true");
    expect(following).toHaveClass("follow--chip");

    await userEvent.click(following);
    expect(mocks.unfollowAuthor).toHaveBeenCalledWith("u1");
    const notice = screen.getByText("Unfollowed danylo").parentElement!;
    await userEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(mocks.followAuthor).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /Following/ })).toBeInTheDocument();
  });

  it("says when following did not go through, and puts the chip back", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.followAuthor.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    openAs(member);
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(await screen.findByText("Couldn’t follow — try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks nothing about a guest, and asks them to sign in when they follow", async () => {
    mocks.loadList.mockResolvedValue(list);
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValue({ kind: "signedIn", switched: false });
    openAs({ kind: "guest", uid: null }, signIn);
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    // A visitor is not signed in as a guest only to learn they follow nobody.
    expect(mocks.followState).not.toHaveBeenCalled();
    const ask = screen.getByRole("dialog", { name: "Sign in to follow" });
    await userEvent.click(within(ask).getByRole("button", { name: "Continue with Google" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(mocks.followAuthor).toHaveBeenCalledWith("u1");
  });
});

describe("ListPage based on", () => {
  it("credits the list it was made from, its title a link to it", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      basedOn: { id: "orig", title: "A24, all of it", authorName: "olena" },
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    const line = document.querySelector(".list-head__based-on")!;
    expect(line).toHaveTextContent("Based on “A24, all of it” by olena");
    expect(
      within(line as HTMLElement).getByRole("link", { name: "A24, all of it" }),
    ).toHaveAttribute("href", "/l/orig");
    // The backend does not say whose page it is: the name is only words.
    expect(within(line as HTMLElement).getAllByRole("link")).toHaveLength(1);
  });

  it("links the original's author to their page when it knows them", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      basedOn: { id: "orig", title: "A24, all of it", authorName: "olena", authorUid: "u5" },
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "olena" })).toHaveAttribute("href", "/u/u5");
  });

  it.each([
    ["an original without an author", { authorName: null }],
    ["an original whose author's name is empty", { authorName: "" }],
    [
      "an editorial original",
      { authorName: "Danylo Petrov", authorUid: "85RRieyLyUPCEqHjdYCdxVlWxHx2" },
    ],
  ])("credits nobody for %s", async (_, credit) => {
    mocks.loadList.mockResolvedValue({
      ...list,
      basedOn: { id: "orig", title: "A24, all of it", ...credit },
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector(".list-head__based-on")).toHaveTextContent(
      /^Based on “A24, all of it”$/,
    );
  });
});

describe("ListPage for its author", () => {
  const author: Session["account"] = {
    kind: "signedIn",
    uid: "u1",
    displayName: "danylo",
    photoUrl: null,
  };

  it("shows the list as it was published, with Edit for its board, and no switch to compare with oneself", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(author);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "by danylo" })).toBeInTheDocument();
    // One does not follow oneself.
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(mocks.followState).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    // The list as the feed has it; it is changed on its board, as on the phone.
    expect(screen.getByRole("region", { name: "Your list" })).toHaveTextContent("Ex Machina");
    expect(screen.queryByLabelText("Add a card")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish changes" })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Edit" }).map((link) => link.getAttribute("href")),
    ).toEqual(["/b/new?list=abc"]);

    // The owner's menu: the link and taking it down; nothing to report or hide, nothing to publish as theirs.
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines()).toEqual(["Rankings · 2,140", "Copy link", "Take it down"]);
    expect(screen.getByRole("button", { name: "Take it down" })).toHaveClass(
      "menu__action--danger",
    );
    expect(screen.queryByRole("link", { name: "Publish as my list" })).toBeNull();
  });

  it("knows its author's own anonymous list by the backend's word, there being no name to compare", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      anonymous: true,
      authorUid: "",
      authorName: "",
      authorPhotoUrl: null,
      mine: true,
    });
    openAs(author);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Edit" }).map((link) => link.getAttribute("href")),
    ).toEqual(["/b/new?list=abc"]);
  });

  it("deletes the list after asking, names a failure, and leaves for My lists when it is gone", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.unpublish.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    mocks.unpublish.mockResolvedValueOnce(undefined);
    openAs(author);
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    const dialog = screen.getByRole("dialog", { name: "Take this list down?" });
    expect(dialog).toHaveTextContent("The list on your phone stays on your phone.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.unpublish).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take it down" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not take it down");

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take it down" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your public lists" }),
    ).toBeInTheDocument();
    expect(mocks.unpublish).toHaveBeenCalledTimes(2);
    expect(mocks.unpublish).toHaveBeenLastCalledWith("abc");
  });

  it.each<ApiError>([{ kind: "notFound" }])(
    "says the list is not available on %o, without blame",
    async (error) => {
      refuse(error);
      open();
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "This list isn’t available",
      );
      expect(screen.getByRole("link", { name: "Go to the front page" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    },
  );

  it("explains an unverified copy of the site and offers no retry", async () => {
    refuse({ kind: "appUnverified" });
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "This copy of the site could not be verified",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("lets a person try again after a dropped connection", async () => {
    refuse({ kind: "offline" });
    mocks.loadList.mockResolvedValueOnce(list);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Every A24 film");
  });

  it.each<ApiError>([{ kind: "unknown", status: 500 }, { kind: "unavailable" }])(
    "names any other failure and still offers a retry: %o",
    async (error) => {
      refuse(error);
      open();
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Could not open this list",
      );
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    },
  );
});
