import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowState } from "../api/community";
import { ApiFailure, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";
import { HIDDEN_KEY } from "../features/community/hidden";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { itemsIn, newBoard, poolTier, rankedTiers } from "../features/boards/model";
import { boards } from "../features/boards/owners";
import { AS_COMMUNITY } from "../features/boards/ownList";
import { EVERYTHING } from "../features/play/chosen";
import { newGame } from "../features/play/game";
import { localGames, playKey } from "../features/play/savedGames";
import { loadPlayScreens } from "../features/play/usePlay";
import { writeKept } from "../features/ranking/kept";
import { draftKey, loadDraft, saveDraft, scopeOf } from "../features/tierboard/draft";
import { localStorageStore, memoryStore } from "../lib/storage";
import { sayOnTheSite } from "../ui/siteNotice";

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
  findPictures: vi.fn(async () => ({ items: [], hasMore: false, notices: [] })),
  removeRanking: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadList: mocks.loadList,
  preloadHidesAuthor: mocks.preloadHidesAuthor,
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
  rankingCount: 3,
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
  entry: string | { pathname: string; state: unknown } = "/l/abc",
) => {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return router;
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
  sayOnTheSite(null);
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
  it("saves the arrangement on show with one button, to one board of the list, and opens it", async () => {
    mocks.loadList.mockResolvedValue({ ...list, coverImageUrl: "https://example.com/cover.jpg" });
    openAs(member);
    // The head's button and the menu's row are the same; the head's is pressed here.
    await screen.findByLabelText("More about this list");
    expect(screen.queryByRole("button", { name: "Save to my lists" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    // On Author it saves the author's arrangement, and asks nothing.
    await userEvent.click(screen.getAllByRole("button", { name: "Save author’s list" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Saved to your lists.")).toBeInTheDocument();

    expect(boards.all()).toHaveLength(1);
    const [saved] = boards.all();
    expect(saved?.title).toBe("Every A24 film, ranked");
    expect(saved?.category).toBe("film_tv");
    expect(saved?.publishedId).toBeNull();
    expect(saved?.takenFrom).toBe("abc");
    // The list's Community cover, not a collage of its cards.
    expect(saved?.coverImageUrls).toEqual(["https://example.com/cover.jpg"]);
    const [s] = rankedTiers(saved!);
    expect(itemsIn(saved!, s!.uid).map((item) => item.title)).toEqual(["Ex Machina"]);
    expect(itemsIn(saved!, poolTier(saved!)!.uid).map((item) => item.title)).toEqual(["The Witch"]);
    expect(screen.getAllByRole("button", { name: "Saved" })).not.toHaveLength(0);

    // On Mine the same button saves one's own version, over the same board.
    await userEvent.click(within(whose()).getByRole("button", { name: "Mine" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Save my list" })[0]!);
    expect(boards.all()).toHaveLength(1);
    const mine = boards.get(saved!.uid)!;
    expect(rankedTiers(mine).flatMap((tier) => itemsIn(mine, tier.uid))).toEqual([]);
    expect(itemsIn(mine, poolTier(mine)!.uid)).toHaveLength(2);

    // Saved, the button opens the board.
    await userEvent.click(screen.getAllByRole("button", { name: "Saved" })[0]!);
    // The board page is a separate chunk; its first load in a test takes a moment.
    expect(await screen.findByText(/2 in pool/, {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Every A24 film, ranked");
    expect(boards.all()).toHaveLength(1);
  });
});

describe("ListPage report and hide", () => {
  it("reports a list from the menu, hides it at once with its author, and leaves on Done", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockResolvedValue(undefined);
    const router = openAs(member);
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
    const receipt = screen.getByRole("dialog", { name: "Reported, and hidden for you" });
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"abc"');
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"u1"');
    // The box was ticked: the receipt does not offer it again.
    expect(within(receipt).queryByRole("button", { name: /hide everything/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    // The page closes, as the app's screen does.
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("offers to hide everything from the author on the receipt, and leaves after", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockResolvedValue(undefined);
    const router = openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    const receipt = await screen.findByRole("dialog", { name: "Reported, and hidden for you" });
    await userEvent.click(
      within(receipt).getByRole("button", { name: "Also hide everything from danylo" }),
    );
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"u1"');
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("shows a list again when its report could not be sent, so it can be reported again", async () => {
    mocks.loadList.mockResolvedValue(list);
    let fail: (reason: unknown) => void = () => undefined;
    mocks.report.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Also hide everything from danylo" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    // Out of sight while the report is on its way.
    expect(screen.getByRole("heading", { level: 2, name: /You hid/ })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reported, and hidden for you" })).toBeVisible();

    await act(async () => fail(new ApiFailure({ kind: "unavailable" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(whose()).toBeInTheDocument();
    expect(hiddenStore.read(HIDDEN_KEY)).toBeNull();
    const snackbar = screen
      .getAllByRole("status")
      .find((el) => el.className === "snackbar-region")!;
    expect(snackbar).toHaveTextContent("nothing was sent");
    await userEvent.click(within(snackbar).getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("dialog", { name: "Report this list" })).toBeInTheDocument();
  });

  it("says a report did not go through on the page the reader went back to, and sends it again", async () => {
    mocks.loadList.mockResolvedValue(list);
    let fail: (reason: unknown) => void = () => undefined;
    mocks.report.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const router = openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));

    // The list page and its snackbar are gone; the site says it.
    await act(async () => fail(new ApiFailure({ kind: "unavailable" })));
    expect(hiddenStore.read(HIDDEN_KEY)).toBeNull();
    const alert = screen.getAllByRole("alert").find((el) => el.className === "snackbar-region")!;
    expect(alert).toHaveTextContent("nothing was sent");
    mocks.report.mockResolvedValue(undefined);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(mocks.report).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenLastCalledWith("abc", { reason: "spam", note: null });
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"abc"');
    expect(screen.queryByText(/nothing was sent/)).toBeNull();
  });

  it("keeps a list hidden before its report hidden when the report fails", async () => {
    hiddenStore.write(HIDDEN_KEY, JSON.stringify({ lists: [{ id: "abc", title: list.title }] }));
    useHiddenStoreForTests(hiddenStore);
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    openAs(member);
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(await screen.findByText(/nothing was sent/)).toBeInTheDocument();
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"abc"');
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
  });

  it("takes a guest's report with no sign-in, as the proxy takes it from the guest's own account", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockResolvedValue(undefined);
    const signIn = vi.fn<Session["signIn"]>();
    openAs({ kind: "guest", uid: "g1" }, signIn);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    expect(screen.queryByRole("dialog", { name: /Sign in/ })).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Something else" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Report" }));
    expect(mocks.report).toHaveBeenCalledWith("abc", { reason: "other", note: null });
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Reported, and hidden for you" })).toBeVisible();
  });

  it("hides from the menu and leaves, and copies the link", async () => {
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const router = openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    const menu = within(screen.getByLabelText("More about this list").closest("details")!);
    await userEvent.click(menu.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/l/abc");
    expect(await screen.findByText("Link copied")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Hide this list" }));
    // The page closes, as the app's screen does.
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"abc"');

    // Opened again, it says it is hidden, with the way back and the way home.
    await act(() => router.navigate("/l/abc"));
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
    expect(screen.getByRole("link", { name: "Go to home" })).toHaveAttribute("href", "/");
    // Its cards stay out of sight: no Play over them.
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
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
    // The save button is the head's on a wide screen and only a phone's line here.
    // Who else ranked it comes first, the one place the number is said.
    expect(menuLines()).toEqual([
      "Rankings · 3",
      "Return all cards to the pool",
      "View danylo",
      "Copy link",
      "Save author’s list",
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
    expect(menuLines().slice(0, 3)).toEqual([
      "Rankings · 3",
      "Return all cards to the pool",
      "Copy link",
    ]);
  });
});

describe("ListPage", () => {
  it("puts the count and Undo in its header while the pool is docked under the board", async () => {
    const had = { width: window.innerWidth, height: window.innerHeight };
    Object.assign(window, { innerWidth: 1600, innerHeight: 900 });
    try {
      mocks.loadList.mockResolvedValue(list);
      open();
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getByRole("button", { name: "Mine" }));
      const article = document.querySelector(".list-page")!;
      expect(article).toHaveClass("list-page--under");
      const head = within(document.querySelector<HTMLElement>(".list-head")!);
      expect(document.querySelector(".list-head .ranking__bar")).not.toBeNull();
      expect(head.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      // Nothing to finish: the head's one Save is what keeps it.
      expect(head.queryByRole("button", { name: "Finish" })).toBeNull();
      expect(head.getAllByRole("button", { name: "Save my list" })).not.toHaveLength(0);

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

    // Author has no tray and no Finish: the author's cards where they put them,
    // what they left unranked under the board, as the app shows it, and how to start.
    expect(within(whose()).getByRole("button", { name: "Author" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    expect(within(theirs).getByRole("list", { name: "S" })).toHaveTextContent("Ex Machina");
    expect(theirs).not.toHaveTextContent("The Witch");
    expect(screen.getByRole("heading", { name: "1 unranked" }).parentElement).toHaveTextContent(
      "The Witch",
    );
    expect(within(theirs).getByRole("status")).toHaveTextContent(
      "Move a card on the board to start your version.",
    );
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(mocks.loadList).toHaveBeenCalledWith("abc", false);
  });

  it("keeps people's text in its own direction, so an Arabic page does not flip a Latin title's '?'", async () => {
    mocks.loadList.mockResolvedValue({ ...list, title: "Top 10 films (2024)?" });
    open();
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.querySelector("bdi")).toHaveTextContent("Top 10 films (2024)?");
    expect(screen.getByRole("link", { name: "by danylo" }).querySelector("bdi")).toHaveTextContent(
      "danylo",
    );
    expect(screen.getByText("Masterpiece").tagName).toBe("BDI");
    expect(screen.getByText("Ex Machina", { selector: ".tile__name" })).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  it("names the photographers the pictures ask for at the list's foot, and has no such part without one", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      items: [
        {
          ...list.items[0]!,
          imageUrl: "https://example.com/ex-machina.jpg",
          credit:
            "Commons contributor ".repeat(24) + "https://creativecommons.org/licenses/by/4.0/",
        },
        list.items[1]!,
      ],
    });
    const { unmount } = open();
    const card = await screen.findByRole("button", { name: "Ex Machina" });
    await userEvent.dblClick(card);
    await userEvent.click(screen.getByRole("menuitem", { name: "About the picture" }));
    expect(screen.getByRole("dialog", { name: "Ex Machina" })).toHaveTextContent(
      "Commons contributor ".repeat(24) + "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(
      screen.getByRole("link", { name: "https://creativecommons.org/licenses/by/4.0/" }),
    ).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    unmount();

    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Picture credits" })).toBeNull();
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

      await userEvent.click(within(whose()).getByRole("button", { name: "Author" }));
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
    expect(screen.getByRole("button", { name: "Rankings · 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide this list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report this list" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^View / })).toBeNull();
    expect(screen.queryByText(/Danylo/)).toBeNull();
  });

  it("tells about a house list's cover picture, as its editor credited it", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      authorUid: "85RRieyLyUPCEqHjdYCdxVlWxHx2",
      coverImageUrl: "https://img.test/cover.jpg",
      coverAttribution: {
        author: "Jane",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        link: "https://commons.wikimedia.org/wiki/File:Cover.jpg",
      },
    });
    open();
    const title = await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "About the cover picture" }));
    const about = screen.getByRole("dialog", { name: `Cover of ${title.textContent}` });
    expect(about).toHaveTextContent("Jane");
    expect(within(about).getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(within(about).getByRole("link", { name: "commons.wikimedia.org" })).toBeInTheDocument();
    // Only read here: nothing to edit.
    expect(within(about).queryByRole("button", { name: "Add credit" })).toBeNull();
    expect(within(about).queryByRole("button", { name: "Edit credit" })).toBeNull();
    await userEvent.click(within(about).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /^Cover of/ })).toBeNull();
  });

  it("offers nothing about the cover of a list with no credit for it", async () => {
    mocks.loadList.mockResolvedValue({ ...list, coverImageUrl: "https://img.test/cover.jpg" });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(screen.queryByRole("button", { name: "About the cover picture" })).toBeNull();
  });

  it("names the author without a link and offers no Follow when the list came without their uid", async () => {
    mocks.loadList.mockResolvedValue({ ...list, authorUid: "" });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector(".byline__name")).toHaveTextContent("by danylo");
    expect(screen.queryByRole("link", { name: "by danylo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
  });

  it("counts the readers' rankings in the menu, not the finishes, and keeps the line when there are none", async () => {
    mocks.loadList.mockResolvedValue({ ...list, takeCount: 0, rankingCount: 3 });
    const { unmount } = open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines()[0]).toBe("Rankings · 3");
    unmount();

    mocks.loadList.mockResolvedValue({ ...list, takeCount: 40, rankingCount: 0 });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines()[0]).toBe("Rankings · 0");
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
  within(whose()).getByRole("button", { name: "Author" }).getAttribute("aria-pressed");
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
    await userEvent.click(within(whose()).getByRole("button", { name: "Author" }));

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

  it("gives a replaced Mine back from the board's own Undo and Ctrl+Z too", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(within(whose()).getByRole("button", { name: "Author" }));
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    await userEvent.click(within(theirs).getByRole("button", { name: "Climax" }));
    await userEvent.keyboard("2");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[0], [1, 2]]);

    // The bar's Undo, not the snackbar's.
    const barUndo = () =>
      screen.getAllByRole("button", { name: "Undo" }).find((b) => b.closest(".snackbar") === null);
    expect(barUndo()).toBeEnabled();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[1], []]);
    expect(barUndo()).toBeDisabled();
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

  it("says the ceiling of people followed, rather than to try again", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.followAuthor.mockRejectedValueOnce(new ApiFailure({ kind: "tooManyFollowing" }));
    openAs(member);
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(
      await screen.findByText("You follow as many people as you can. Unfollow someone first."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/try again/)).toBeNull();
  });

  it("says a refused unfollow as one, in place of the snackbar that said it was done", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.followState.mockResolvedValue({ following: true, followers: 3 });
    mocks.unfollowAuthor.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    openAs(member);
    await userEvent.click(await screen.findByRole("button", { name: /Following/ }));
    expect(await screen.findByText("Couldn’t unfollow — try again.")).toBeInTheDocument();
    expect(screen.queryByText("Unfollowed danylo")).toBeNull();
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

  it("shows the list as it was published, with Save my list for its board, and no switch to compare with oneself", async () => {
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
      screen
        .getAllByRole("link", { name: "Save my list" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/b/new?list=abc"]);
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();

    // The owner's menu: the link and taking it down; nothing to report or hide, nothing to publish as theirs.
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines()).toEqual(["Rankings · 3", "Copy link", "Take it down"]);
    expect(screen.getByRole("button", { name: "Take it down" })).toHaveClass(
      "menu__action--danger",
    );
    expect(screen.queryByRole("link", { name: "Publish as my list" })).toBeNull();
    expect(
      screen.queryByText(/Publish (a separate list|this list in your public lists)/),
    ).toBeNull();
  });

  // Held, the list answers its author and moderators, and nobody else yet:
  // a link handed on would open on "This list isn't available".
  it("tells its author a held list waits for a moderator and hands out no link to it (QA P17)", async () => {
    mocks.loadList.mockResolvedValue({ ...list, underReview: true });
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      openAs(author);
      await screen.findByRole("heading", { level: 1 });
      expect(
        within(document.querySelector<HTMLElement>(".list-head")!).getByText(
          "It waits for a moderator before others can see it.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
      expect(
        screen
          .getAllByRole("link", { name: "Save my list" })
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/b/new?list=abc"]);
      await userEvent.click(screen.getByLabelText("More about this list"));
      expect(menuLines()).toEqual(["Rankings · 3", "Take it down"]);
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("says nothing of a moderator on its author's list that is out", async () => {
    mocks.loadList.mockResolvedValue({ ...list, underReview: false });
    openAs(author);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("It waits for a moderator before others can see it.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Copy link" }).length).toBeGreaterThan(0);
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
      screen
        .getAllByRole("link", { name: "Save my list" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/b/new?list=abc"]);
    // And says it is one's own, gone out without a name, as its card does.
    expect(screen.getByText("Your list, published anonymously")).toBeInTheDocument();
  });

  it("deletes the list after asking, names a failure, and leaves for Your lists when it is gone", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.unpublish.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    mocks.unpublish.mockResolvedValueOnce(undefined);
    openAs(author);
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    const dialog = screen.getByRole("dialog", { name: "Take this list down?" });
    expect(dialog).toHaveTextContent("Your board stays in Your lists.");
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
      await screen.findByRole("heading", { level: 1, name: "Your lists" }),
    ).toBeInTheDocument();
    expect(mocks.unpublish).toHaveBeenCalledTimes(2);
    expect(mocks.unpublish).toHaveBeenLastCalledWith("abc");
  });

  it("opens one's own list as one's own board when this browser has it, in place of the page", async () => {
    mocks.loadList.mockResolvedValue(list);
    boards.save({ ...newBoard("b1", "Every A24 film", 1, () => "t"), publishedId: "abc" });
    const router = openAs(author);
    await waitFor(() => expect(router.state.location.pathname).toBe("/b/b1"));
    // Back returns to where the list was tapped, not to its page.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("keeps the list's page for its author without a board here, or when the board asked to see it as others do", async () => {
    mocks.loadList.mockResolvedValue(list);
    // In the trash, the board is not where the list is changed.
    boards.save({ ...newBoard("b2", "Gone", 1, () => "t"), publishedId: "abc", deletedAt: 5 });
    const router = openAs(author);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(list.title);
    expect(router.state.location.pathname).toBe("/l/abc");
    cleanup();

    boards.save({ ...newBoard("b1", "Every A24 film", 1, () => "t"), publishedId: "abc" });
    const seen = openAs(author, undefined, { pathname: "/l/abc", state: AS_COMMUNITY });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(list.title);
    expect(seen.state.location.pathname).toBe("/l/abc");
  });

  it("waits to know who is here before it shows a list a board here published", async () => {
    mocks.loadList.mockResolvedValue(list);
    boards.save({ ...newBoard("b1", "Every A24 film", 1, () => "t"), publishedId: "abc" });
    openAs(null);
    expect(await screen.findByText("Opening the list…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: list.title })).toBeNull();
  });

  it("makes the board the list was published from its own again once it is down", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.unpublish.mockResolvedValueOnce(undefined);
    boards.save({
      ...newBoard("b1", "Every A24 film", 1, () => "t"),
      publishedId: "abc",
      publishedEditedAt: 1,
      authorName: "danylo",
    });
    // Reached from the board's settings: with the board here, nothing else opens this page.
    const router = openAs(author, undefined, { pathname: "/l/abc", state: AS_COMMUNITY });
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take it down" }),
    );
    await screen.findByRole("heading", { level: 1, name: "Your lists" });
    expect(boards.get("b1")).toMatchObject({ publishedId: null, authorName: null });
    // The gone list's page left the history: Back does not lead its author to it.
    expect(router.state.historyAction).toBe("REPLACE");
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

describe("ListPage, Play", () => {
  // The screens come as a chunk of their own; fetched here, Play opens in the frame it is pressed.
  beforeAll(() => loadPlayScreens());

  /** Answers with ← until the game is over and its result is on the board. */
  const playToTheEnd = async () => {
    const label = () => screen.queryAllByText(/^Duel/)[0]?.textContent;
    while (label() !== undefined) {
      const before = label();
      await userEvent.keyboard("{ArrowLeft}");
      await waitFor(() => expect(label()).not.toBe(before));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 3000 });
  };
  /** The board's Undo, not a snackbar's. */
  const barUndo = () =>
    screen.getAllByRole("button", { name: "Undo" }).find((b) => b.closest(".snackbar") === null)!;
  const mineS = () =>
    within(screen.getByRole("region", { name: "Your ranking" })).getByRole("list", { name: "S" });
  /** Mine's rows as this device keeps them. */
  const rowsNow = (): unknown => JSON.parse(localStorage.getItem(draftKey("abc"))!).rows;

  it("ends a game on Mine, and the board's Undo turns its result over", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    const before = rowsNow();
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await playToTheEnd();
    // No result screen, no Put in Mine, no Refine: the ordinary board of the list.
    expect(screen.queryByRole("heading", { name: "Your result" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Put in Mine|Refine|Apply)$/ })).toBeNull();
    const after = rowsNow();
    expect(after).not.toEqual(before);
    const said = snackbar("Board arranged from 2 duels");
    expect(said.queryByRole("button", { name: "Undo" })).toBeNull();
    const played = mineS().textContent;

    // Undo: Mine as it was before the game. Undo again: the game's arrangement.
    await userEvent.click(barUndo());
    expect(rowsNow()).toEqual(before);
    expect(mineS()).toHaveTextContent("The Witch");
    await userEvent.click(barUndo());
    expect(rowsNow()).toEqual(after);
    expect(mineS().textContent).toBe(played);
    // And once more, as Ctrl+Z.
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(rowsNow()).toEqual(before);
  });

  it("undoes moves made after a game first, one by one, then the game", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    const before = rowsNow();
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await playToTheEnd();
    const after = rowsNow();
    // A move by hand after the game.
    const mine = screen.getByRole("region", { name: "Your ranking" });
    await userEvent.click(within(mine).getByRole("button", { name: "Ex Machina" }));
    // Wherever the game put it, somewhere else.
    await userEvent.click(screen.getAllByRole("button", { name: /^Place Ex Machina in / })[0]!);
    const moved = rowsNow();
    expect(moved).not.toEqual(after);

    await userEvent.click(barUndo());
    expect(rowsNow()).toEqual(after);
    await userEvent.click(barUndo());
    expect(rowsNow()).toEqual(before);
    // The game's step turns over; the move by hand is gone with the history it was in.
    await userEvent.click(barUndo());
    expect(rowsNow()).toEqual(after);
  });

  it("asks once, right after a game, whether to show the ranking, a guest to sign in for it", async () => {
    localStorage.clear();
    mocks.loadList.mockResolvedValue(twoTiers);
    openAs({ kind: "guest", uid: "g1" });
    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.queryByRole("complementary", { name: "Show others how you ranked it?" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await playToTheEnd();
    const offer = await screen.findByRole("complementary", {
      name: "Show others how you ranked it?",
    });
    expect(within(offer).getByRole("button", { name: "Sign in to share" })).toBeInTheDocument();
    await userEvent.click(within(offer).getByRole("button", { name: "Not now" }));
    expect(
      screen.queryByRole("complementary", { name: "Show others how you ranked it?" }),
    ).toBeNull();
    localStorage.clear();
  });

  it("quits on the browser's Back and stays on the list, the game kept", async () => {
    mocks.loadList.mockResolvedValue(twoTiers);
    const router = createMemoryRouter(routes, { initialEntries: ["/about", "/l/abc"] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Every A24 film, ranked" });

    // The picker first: Back closes it.
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("dialog", { name: "Play" })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/l/abc");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(screen.getAllByText("Duel 2 of 2")).not.toHaveLength(0));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/l/abc");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Game saved · 1 of 2")).toBeInTheDocument();
    expect(localStorage.getItem(playKey("list:abc"))).not.toBeNull();

    // Away from Play, Back goes back.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/about");
  });

  it("drops a game saved over the list before it was published again", async () => {
    const game = newGame("swiss", ["0", "1", "2"], EVERYTHING, 4, Date.now());
    localGames(localStorageStore, Date.now, "0:3").save("list:abc", game);
    mocks.loadList.mockResolvedValue({ ...twoTiers, updatedAt: 1 });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(localStorage.getItem(playKey("list:abc"))).toBeNull();
  });

  it("resumes a game saved over the list as it stands", async () => {
    const game = newGame("swiss", ["0", "1", "2"], EVERYTHING, 4, Date.now());
    localGames(localStorageStore, Date.now, "0:3").save("list:abc", game);
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});
