import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowState } from "../api/community";
import { ApiFailure, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";
import { HIDDEN_KEY } from "../features/community/hidden";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { addToPool, itemsIn, newBoard, poolTier, rankedTiers } from "../features/boards/model";
import { boards } from "../features/boards/owners";
import { boardFromList, publishRequestOf } from "../features/boards/publish";
import { AS_COMMUNITY } from "../features/boards/ownList";
import { EVERYTHING } from "../features/play/chosen";
import { newGame } from "../features/play/game";
import { localGames, playKey } from "../features/play/savedGames";
import { loadPlayScreens } from "../features/play/usePlay";
import { writeKept } from "../features/ranking/kept";
import {
  draftKey,
  loadDraft,
  loadPlacedDraft,
  saveDraft,
  scopeOf,
} from "../features/tierboard/draft";
import { localStorageStore, memoryStore } from "../lib/storage";
import { usage } from "../lib/usage";
import { sayOnTheSite } from "../ui/siteNotice";

/** Mine as this device keeps it, but when: every save says its own moment (for Continue). */
function keptDraft(): unknown {
  const text = localStorage.getItem(draftKey("abc"));
  if (text === null) return null;
  const { savedAt: _when, ...draft } = JSON.parse(text) as Record<string, unknown>;
  return draft;
}

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

/** The menu's line, pressed: "Start from scratch", "Back to danylo’s ranking". */
const fromMenu = async (line: string) => {
  await userEvent.click(screen.getByLabelText("More about this list"));
  await userEvent.click(screen.getByRole("button", { name: line }));
};

/** One's own version with every card in the deck, as the menu's Start from scratch makes it. */
const fromScratch = () => fromMenu("Start from scratch");

/** The menu's lines in their order, the separator as "—". */
/** The menu's lines as read; a toggle's check is its state, said by aria-checked, not a word. */
const menuLines = () =>
  [...document.querySelectorAll(".list-head .menu__list > li")].map((line) =>
    line.getAttribute("role") === "separator"
      ? "—"
      : (line.textContent ?? "").replace(/check$/, ""),
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

    // Once there is a version of one's own, the same button saves it, over the same board.
    await fromScratch();
    await userEvent.click(screen.getAllByRole("button", { name: "Save my list" })[0]!);
    expect(boards.all()).toHaveLength(1);
    const mine = boards.get(saved!.uid)!;
    expect(rankedTiers(mine).flatMap((tier) => itemsIn(mine, tier.uid))).toEqual([]);
    expect(itemsIn(mine, poolTier(mine)!.uid)).toHaveLength(2);

    // Saved, the button opens the board.
    await userEvent.click(screen.getAllByRole("button", { name: "Saved" })[0]!);
    // The board page is a separate chunk; its first load in a test takes a moment.
    expect(await screen.findByText("0 of 2 placed", {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Every A24 film, ranked");
    expect(boards.all()).toHaveLength(1);
  });
});

describe("ListPage and the board the list was saved to", () => {
  const counter = () => {
    let n = 0;
    return () => `card-${n++}`;
  };
  const savedCopy = () => ({
    ...boardFromList(unarranged, [[1]], 1, counter()),
    uid: "copy-1",
  });

  it("starts Mine from it when this device placed nothing, and the button says Saved", async () => {
    mocks.loadList.mockResolvedValue(unarranged);
    // This device only opened the list once: its draft places nothing.
    saveDraft(localStorageStore, scopeOf(unarranged), [[]]);
    boards.save(savedCopy());
    openAs(member);
    expect(await screen.findByText("1 of 2 placed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Saved" })).not.toHaveLength(0);
    expect(loadDraft(localStorageStore, scopeOf(unarranged))).toEqual([[1]]);
    expect(boards.all()).toHaveLength(1);
  });

  it("starts Mine from it when the account's boards come after the page", async () => {
    mocks.loadList.mockResolvedValue(unarranged);
    openAs(member);
    expect(await screen.findByText("0 of 2 placed")).toBeInTheDocument();
    act(() => void boards.save(savedCopy()));
    expect(await screen.findByText("1 of 2 placed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Saved" })).not.toHaveLength(0);
  });

  it("leaves what this device placed itself", async () => {
    mocks.loadList.mockResolvedValue(unarranged);
    saveDraft(localStorageStore, scopeOf(unarranged), [[0]]);
    boards.save(savedCopy());
    openAs(member);
    expect(await screen.findByText("1 of 2 placed")).toBeInTheDocument();
    expect(loadDraft(localStorageStore, scopeOf(unarranged))).toEqual([[0]]);
    expect(screen.getAllByRole("button", { name: "Save my list" })).not.toHaveLength(0);
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
    expect(screen.getByRole("region", { name: "Their ranking" })).toBeInTheDocument();
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

  // Proxy #173: past the day's new reports, Try again would only be refused again.
  it("says the day's reports are used up, with no Try again", async () => {
    useHiddenStoreForTests(hiddenStore);
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockRejectedValue(
      new ApiFailure({ kind: "tooManyRequests", code: "REPORT_DAILY_LIMIT", retryAt: 1 }),
    );
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(
      await screen.findByText("You’ve sent many reports today. Try again later."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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
    // The menu's Share; a phone's head has a Share of its own, beside Save.
    const inMenu = () => within(screen.getByLabelText("More about this list").closest("details")!);
    expect(inMenu().queryByRole("button", { name: "Share" })).toBeNull();
    cleanup();

    const share = vi.fn(() => Promise.reject(new DOMException("closed", "AbortError")));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      openAs(member);
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getByLabelText("More about this list"));
      await userEvent.click(inMenu().getByRole("button", { name: "Share" }));
      expect(share).toHaveBeenCalledWith({ title: list.title, url: "http://localhost:3000/l/abc" });
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });
});

describe("ListPage menu", () => {
  it("says under the title how many others ranked it, a way into their rankings (artboard 36)", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(
      screen.getByRole("button", { name: "3 rankings — see how others placed them" }),
    );
    expect(await screen.findByRole("dialog", { name: "Rankings" })).toBeInTheDocument();
  });

  it("has no such line for a list nobody else ranked", async () => {
    mocks.loadList.mockResolvedValue({ ...list, rankingCount: 0 });
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /see how others placed them/ })).toBeNull();
  });

  it("has the app's lines in the app's order, the report in the error colour", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    // The save button is the head's on a wide screen and only a phone's line here.
    // Who else ranked it comes first, the one place the number is said.
    expect(menuLines()).toEqual([
      "Rankings · 3",
      "Start from scratch",
      "Names on cards",
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
    expect(menuLines().slice(0, 4)).toEqual([
      "Rankings · 3",
      "Start from scratch",
      "Names on cards",
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
      await fromScratch();
      const article = document.querySelector(".list-page")!;
      // Somebody else's list on a wide window has its cards beside the board at first (artboard 21).
      expect(article).toHaveClass("list-page--beside");
      await userEvent.click(screen.getByRole("button", { name: "Cards under the tiers" }));
      expect(article).toHaveClass("list-page--under");
      const head = within(document.querySelector<HTMLElement>(".list-head")!);
      expect(document.querySelector(".list-head .ranking__bar")).not.toBeNull();
      expect(head.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      // Nothing to finish: the head's one Save is what keeps it.
      expect(head.queryByRole("button", { name: "Finish" })).toBeNull();
      expect(head.getAllByRole("button", { name: "Save my list" })).not.toHaveLength(0);

      // Moving the pool does not move the buttons: they stay in the header.
      await userEvent.click(screen.getByRole("button", { name: "Cards beside the tiers" }));
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
    // A phone's head counts the cards in the author's line, before Follow.
    expect(author.closest(".byline")!.querySelector(".byline__count")).toHaveTextContent(
      "· 2 cards",
    );
    // How many ranked it is not said in the head: it is a line of the ⋮ menu.
    expect(screen.queryByRole("button", { name: /rankings$/ })).toBeNull();
    expect(document.querySelector(".list-head__lines")).not.toHaveTextContent(/2,140|rankings/);
    // The address is not spelled out any more: one press copies it.
    expect(screen.queryByText(`${window.location.host}/l/abc`)).toBeNull();

    // No Author | Mine (25.11.2026), and no version of one's own to name yet.
    // The author's cards where they put them, what they left unranked in the
    // board's pool, and how to start; no tray and no Finish.
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(screen.queryByText(/Your version/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Save author’s list" })).not.toHaveLength(0);
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    expect(within(theirs).getByRole("list", { name: "S" })).toHaveTextContent("Ex Machina");
    expect(theirs.querySelector(".board")).not.toHaveTextContent("The Witch");
    expect(
      within(theirs).getByRole("heading", { name: "Cards left · 1" }).closest(".pool"),
    ).toHaveTextContent("The Witch");
    // How to start one's own stands under the title, not under the last tier (Danylo, 25.11).
    const start = screen.getByText("Move a card to start your version.");
    expect(start.closest(".list-head")).not.toBeNull();
    expect(theirs).not.toHaveTextContent("Move a card to start your version.");
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

  it("starts from scratch from the menu at once: every card in the deck, and Undo brings the author's back", async () => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    try {
      mocks.loadList.mockResolvedValue(list);
      open();
      await screen.findByRole("heading", { level: 1 });
      await fromScratch();
      // No question asked.
      expect(screen.queryByRole("dialog")).toBeNull();
      const yours = screen.getByRole("region", { name: "Your ranking" });
      expect(document.querySelector(".list-head")).toHaveTextContent("0 of 2 placed");
      expect(yours).toHaveTextContent("2 cards left");
      expect(document.querySelector(".list-head__version")).toHaveTextContent(
        "Your version · see danylo’s",
      );
      expect(screen.getAllByRole("button", { name: "Save my list" })).not.toHaveLength(0);
      // The same cards move between the boards rather than the boards swapping.
      const durations = animate.mock.calls.map(
        ([, options]) => (options as KeyframeAnimationOptions).duration,
      );
      expect(durations).toContain(200);

      await userEvent.click(
        snackbar("All cards are back in Cards left").getByRole("button", { name: "Undo" }),
      );
      expect(screen.getByRole("region", { name: "Their ranking" })).toHaveTextContent("Ex Machina");
      expect(localStorageStore.read(draftKey("abc"))).toBeNull();
      expect(screen.queryByText(/Your version/)).toBeNull();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("puts the author's ranking in place of one's own from the menu at once, and Undo puts it back", async () => {
    saveDraft(localStorageStore, scopeOf(list), [[1]]);
    const before = keptDraft();
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    await fromMenu("Back to danylo’s ranking");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Still one's own version, now the author's arrangement.
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    expect(loadPlacedDraft(localStorageStore, scopeOf(list))).toEqual([[0]]);
    await userEvent.click(
      snackbar("Replaced your version with danylo’s ranking").getByRole("button", { name: "Undo" }),
    );
    expect(keptDraft()).toEqual(before);
    expect(document.querySelector(".list-head")).toHaveTextContent("1 of 2 placed");

    // Start from scratch over one's own version: its Undo gives the same version back.
    await fromScratch();
    expect(loadPlacedDraft(localStorageStore, scopeOf(list))).toBeNull();
    await userEvent.click(
      snackbar("All cards are back in Cards left").getByRole("button", { name: "Undo" }),
    );
    expect(keptDraft()).toEqual(before);
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
  });

  it("looks at the author's ranking read-only from the line under the title, and goes back to one's own", async () => {
    saveDraft(localStorageStore, scopeOf(list), [[1]]);
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    const see = screen.getByRole("button", { name: "see danylo’s" });
    expect(see.closest(".list-head__version")).toHaveTextContent("Your version · see danylo’s");
    await userEvent.click(see);
    const strip = screen.getByRole("region", { name: "danylo’s ranking" });
    expect(strip).toHaveTextContent("danylo’s ranking");
    const back = within(strip).getByRole("button", { name: "Back to yours" });
    expect(back).toHaveFocus();
    // Read-only: the author's cards, no Undo, no version line; Save still keeps one's own.
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    expect(theirs).toHaveTextContent("Ex Machina");
    expect(screen.queryByRole("region", { name: "Your ranking" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText(/Your version/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Save my list" })).not.toHaveLength(0);

    await userEvent.click(back);
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "danylo’s ranking" })).toBeNull();
    expect(screen.getByRole("button", { name: "see danylo’s" })).toHaveFocus();
    expect(loadPlacedDraft(localStorageStore, scopeOf(list))).toEqual([[1]]);
  });

  it("says the author’s for a list without the author's name, everywhere it would name them", async () => {
    saveDraft(localStorageStore, scopeOf(list), [[1]]);
    mocks.loadList.mockResolvedValue({ ...list, authorName: "" });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector(".list-head__version")).toHaveTextContent(
      "Your version · see the author’s",
    );
    await userEvent.click(screen.getByRole("button", { name: "see the author’s" }));
    const strip = screen.getByRole("region", { name: "The author’s ranking" });
    await userEvent.click(within(strip).getByRole("button", { name: "Back to yours" }));
    await fromMenu("Back to the author’s ranking");
    expect(screen.getByText("Replaced your version with the author’s ranking")).toBeInTheDocument();
  });

  it("opens on Mine where this device has begun a ranking of the list", async () => {
    saveDraft(localStorageStore, scopeOf(list), [[1]]);
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    expect(document.querySelector(".list-head")).toHaveTextContent("1 of 2 placed");
    expect(document.querySelector(".list-head__version")).toHaveTextContent(
      "Your version · see danylo’s",
    );
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

  it("opens a house list, with no author's arrangement, on one's own board, its cards in the deck, as before", async () => {
    mocks.loadList.mockResolvedValue(unarranged);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("region", { name: "Your ranking" })).toHaveTextContent("2 cards left");
    // No author's arrangement to look at or go back to, and nothing placed to clear.
    expect(screen.queryByText(/Your version/)).toBeNull();
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(menuLines()).not.toContain("Start from scratch");
    expect(menuLines().some((line) => line.startsWith("Back to"))).toBe(false);
  });

  it("stands without an author when the list is editorial", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      authorUid: "tyl-editorial",
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
      authorUid: "tyl-editorial",
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

  it("has Share as the one link button in the head, with no Copy link chip beside it (Designer, 25.11)", async () => {
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector(".list-head__copy")).toBeNull();
    const head = document.querySelector<HTMLElement>(".list-head__tools .list-head__share")!;
    expect(head).toHaveAccessibleName("Share");
    // No share sheet: the link goes on the clipboard.
    await userEvent.click(head);
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/l/abc");
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

/** The author's arrangement is the board on show, not one's own version. */
const onTheirs = () => screen.queryByRole("region", { name: "Their ranking" }) !== null;
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
    expect(onTheirs()).toBe(true);
    expect(localStorage.getItem(draftKey("abc"))).toBeNull();
    expect(screen.getByText("Placing it starts your version from danylo’s.")).toBeInTheDocument();

    await userEvent.keyboard("2");
    // Nothing of one's own to lose: no question, and the version is one's own now.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onTheirs()).toBe(false);
    expect(document.querySelector(".list-head__version")).toHaveTextContent(
      "Your version · see danylo’s",
    );
    const yours = screen.getByRole("region", { name: "Your ranking" });
    expect(within(yours).getByRole("list", { name: "A" })).toHaveTextContent("The WitchEx Machina");
    expect(within(yours).getByRole("list", { name: "S" })).toHaveTextContent("Climax");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[2], [1, 0]]);

    const said = snackbar("Your version starts from danylo’s ranking");
    await userEvent.click(said.getByRole("button", { name: "Undo" }));
    expect(localStorage.getItem(draftKey("abc"))).toBeNull();
    expect(onTheirs()).toBe(true);
    expect(screen.queryByText(/Your version ·/)).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Their ranking" })).getByRole("list", {
        name: "S",
      }),
    ).toHaveTextContent("Ex MachinaClimax");
  });

  it("opens a version begun here as one's own, the author's only to look at: no move there replaces it", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    const before = keptDraft();
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(onTheirs()).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "see danylo’s" }));
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    // Read-only: a card opens what its picture says, and nothing moves.
    await userEvent.dblClick(within(theirs).getByRole("button", { name: "Climax" }));
    expect(screen.queryByRole("menuitem", { name: "Move to a tier" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /Start from/ })).toBeNull();
    expect(keptDraft()).toEqual(before);
  });

  it("gives the author's ranking put in place of one's own back from the board's own Undo and Ctrl+Z too", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    await fromMenu("Back to danylo’s ranking");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[0, 2], [1]]);

    // The bar's Undo, not the snackbar's.
    const barUndo = () =>
      screen.getAllByRole("button", { name: "Undo" }).find((b) => b.closest(".snackbar") === null);
    expect(barUndo()).toBeEnabled();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[1], []]);
    expect(barUndo()).toBeDisabled();
  });

  it("asks nothing over a Mine with no card placed", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[], []]);
    mocks.loadList.mockResolvedValue(twoTiers);
    open();
    await screen.findByRole("heading", { level: 1 });
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    await userEvent.click(within(theirs).getByRole("button", { name: "Climax" }));
    await userEvent.keyboard("2");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[0], [1, 2]]);
    expect(screen.getByText("Your version starts from danylo’s ranking")).toBeInTheDocument();
  });

  it("puts the author's back for a signed-in reader with no question, names nobody without the author's name, and goes on", async () => {
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    mocks.loadList.mockResolvedValue({ ...twoTiers, authorName: " " });
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await fromMenu("Back to the author’s ranking");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[0, 2], [1]]);
    expect(screen.getByText("Replaced your version with the author’s ranking")).toBeInTheDocument();
    // One's own version still: the next move is its own, with no question.
    const yours = screen.getByRole("region", { name: "Your ranking" });
    await userEvent.click(within(yours).getByRole("button", { name: "Climax" }));
    await userEvent.keyboard("2");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[0], [1, 2]]);
  });

  it("starts from an arrow key too, and names nobody where the list has no author's name", async () => {
    mocks.loadList.mockResolvedValue({ ...twoTiers, authorName: " " });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Ex Machina" }));
    expect(
      screen.getByText("Placing it starts your version from the author’s."),
    ).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(onTheirs()).toBe(false);
    expect(loadDraft(localStorageStore, scopeOf(twoTiers))).toEqual([[2, 0], [1]]);
    expect(screen.getByText("Your version starts from the author’s ranking")).toBeInTheDocument();
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
    ["an editorial original", { authorName: "Danylo Petrov", authorUid: "tyl-editorial" }],
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

describe("ListPage source", () => {
  it("says where a house list's cards came from, linked to the page", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      listSource: { label: "Nix's fruit stream", url: "https://www.twitch.tv/videos/123456789" },
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/^Source:/)).toHaveTextContent("Source: Nix's fruit stream");
    const link = screen.getByRole("link", { name: "Nix's fruit stream" });
    expect(link).toHaveAttribute("href", "https://www.twitch.tv/videos/123456789");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("says nothing of a source on a list without one", async () => {
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/^Source:/)).toBeNull();
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
    expect(menuLines()).toEqual(["Rankings · 3", "Names on cards", "Copy link", "Take it down"]);
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
      expect(menuLines()).toEqual(["Rankings · 3", "Names on cards", "Take it down"]);
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  // New and waiting for staff before the feed (Danylo, 26.11.2026): its author
  // is told, and its link is handed out, since it already opens for everybody.
  it("tells its author a new list reaches the feed after a check, and still gives its link", async () => {
    mocks.loadList.mockResolvedValue({ ...list, awaitingApproval: true });
    openAs(author);
    await screen.findByRole("heading", { level: 1 });
    expect(
      within(document.querySelector<HTMLElement>(".list-head")!).getByText(
        "It will appear in the feed after a check. Anyone with the link can see it now.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy link" }).length).toBeGreaterThan(0);
  });

  it("says nothing of a check to anybody else on a list waiting for one", async () => {
    mocks.loadList.mockResolvedValue({ ...list, awaitingApproval: true });
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.queryByText(
        "It will appear in the feed after a check. Anyone with the link can see it now.",
      ),
    ).toBeNull();
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
    expect(dialog).toHaveTextContent("You keep it in Your lists.");
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

  // What the link shows is behind the author's board: the page says so and leads to Update (23.11).
  it("tells its author, seeing it as others do, that the board has changes the list does not show yet", async () => {
    mocks.loadList.mockResolvedValue(list);
    boards.save({
      ...newBoard("b1", "Every A24 film", 1, () => "t"),
      publishedId: "abc",
      publishedEditedAt: 1,
      editedAt: 9,
    });
    openAs(author, undefined, { pathname: "/l/abc", state: AS_COMMUNITY });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/Changes not published yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Update" })).toHaveAttribute("href", "/b/b1");
    cleanup();

    boards.save({ ...boards.get("b1")!, publishedEditedAt: 9 });
    openAs(author, undefined, { pathname: "/l/abc", state: AS_COMMUNITY });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/Changes not published yet/)).toBeNull();
  });

  // QA, 23.11: the time of a board from the account is guessed from its list,
  // and read as behind though the list shows the board as it is.
  // Coordinator, 23.11: a time guessed before the guess was marked reads the same.
  it.each([true, false])(
    "says nothing of changes when the list shows the board as it is (time guessed: %s)",
    async (guessed) => {
      const made = addToPool(
        { ...newBoard("b1", "Every A24 film", 1, () => "t"), category: "film_tv" },
        [{ title: "Heat", imageUrl: null }],
        1,
        () => "c1",
      );
      const board = {
        ...made,
        publishedId: "abc",
        editedAt: 6500,
        publishedEditedAt: 1000,
        ...(guessed ? { publishedEditedAtGuessed: true as const } : {}),
      };
      boards.save(board);
      const request = publishRequestOf(board)!;
      mocks.loadList.mockResolvedValue({
        ...list,
        title: request.title,
        category: request.category,
        tiers: request.tiers,
        items: request.items.map(({ title, tierIndex }) => ({ title, imageUrl: null, tierIndex })),
      });
      openAs(author, undefined, { pathname: "/l/abc", state: AS_COMMUNITY });
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByText(/Changes not published yet/)).toBeNull();
      await waitFor(() => expect(boards.get("b1")?.publishedEditedAt).toBe(6500));
    },
  );

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

  /** Answers with ← until the game is over and its result is on the board, in the end window. */
  const playToTheWindow = async () => {
    const label = () => screen.queryAllByText(/^Duel/)[0]?.textContent;
    while (label() !== undefined) {
      const before = label();
      await userEvent.keyboard("{ArrowLeft}");
      await waitFor(() => expect(label()).not.toBe(before));
    }
    return screen.findByRole("dialog", { name: "Your ranking is ready" }, { timeout: 3000 });
  };
  /** The same, and See my list closes the window. */
  const playToTheEnd = async () => {
    const ready = await playToTheWindow();
    await userEvent.click(within(ready).getByRole("button", { name: "See my list" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Other ways to play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await playToTheEnd();
    // No result screen, no Put in Mine, no Refine: the ordinary board of the list.
    expect(screen.queryByRole("heading", { name: "Your result" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Put in Mine|Refine|Apply)$/ })).toBeNull();
    const after = rowsNow();
    expect(after).not.toEqual(before);
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
    await userEvent.click(screen.getByRole("button", { name: "Other ways to play" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Other ways to play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    // The end window says it first; the offer under it waits until it closes (artboard 35).
    const ready = await playToTheWindow();
    expect(
      within(ready).getByRole("button", { name: "Sign in to show it in Rankings" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Show others how you ranked it?" }),
    ).toBeNull();
    await userEvent.click(within(ready).getByRole("button", { name: "See my list" }));
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

  it("takes the offer away with the game the board's Undo takes back (QA 25)", async () => {
    localStorage.clear();
    saveDraft(localStorageStore, scopeOf(twoTiers), [[1], []]);
    mocks.loadList.mockResolvedValue(twoTiers);
    openAs({ kind: "guest", uid: "g1" });
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("button", { name: "Other ways to play" }));
    await userEvent.click(screen.getByRole("radio", { name: /King of the hill/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await playToTheEnd();
    await screen.findByRole("complementary", { name: "Show others how you ranked it?" });
    await userEvent.click(barUndo());
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
    await userEvent.click(screen.getByRole("button", { name: "Other ways to play" }));
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

  // Walk 25.11: there is no Mine any more, and a house list has no author to name.
  it("says the game's result goes into one's version, naming the author only where there is one", async () => {
    mocks.loadList.mockResolvedValue(twoTiers);
    const { unmount } = open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(
      screen.getByText("The result goes into your version. The author’s ranking doesn’t change."),
    ).toBeInTheDocument();
    unmount();

    mocks.loadList.mockResolvedValue({ ...twoTiers, authorUid: "tyl-editorial" });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    const play = within(screen.getByRole("dialog", { name: "Play" }));
    expect(play.getByText("The result goes into your version.")).toBeInTheDocument();
    expect(play.queryByText(/author/i)).toBeNull();
  });
});

describe("ListPage usage statistics", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Five cards, every one placed by the author: a first move on Theirs finishes Mine. */
  const fivePlaced: PublishedList = {
    ...twoTiers,
    itemCount: 5,
    items: ["Ex Machina", "The Witch", "Climax", "Heat", "Alien"].map((title, index) => ({
      title,
      imageUrl: null,
      tierIndex: index % 2,
    })),
  };

  it("says somebody else's list was opened once it is known whose it is", async () => {
    const step = vi.spyOn(usage, "step");
    mocks.loadList.mockResolvedValue(list);
    openAs(null);
    await screen.findByRole("heading", { level: 1 });
    expect(step).not.toHaveBeenCalledWith("open_list");
    cleanup();
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    expect(step).toHaveBeenCalledWith("open_list");
  });

  it("says nothing opened for the list's own author", async () => {
    const step = vi.spyOn(usage, "step");
    mocks.loadList.mockResolvedValue(list);
    openAs({ kind: "signedIn", uid: "u1", displayName: "danylo", photoUrl: null });
    await screen.findByRole("heading", { level: 1 });
    expect(step).not.toHaveBeenCalledWith("open_list");
  });

  it("counts the link copied from the head and the menu, and handed to the share sheet", async () => {
    const step = vi.spyOn(usage, "step");
    const count = vi.spyOn(usage, "count");
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      openAs(member);
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getAllByRole("button", { name: "Copy link" })[0]!);
      await waitFor(() => expect(count.mock.calls).toEqual([["share.link"]]));
      expect(step).toHaveBeenCalledWith("shared");

      await userEvent.click(screen.getByLabelText("More about this list"));
      const menu = within(screen.getByLabelText("More about this list").closest("details")!);
      await userEvent.click(menu.getByRole("button", { name: "Copy link" }));
      await waitFor(() => expect(count.mock.calls).toEqual([["share.link"], ["share.link"]]));

      await userEvent.click(screen.getByLabelText("More about this list"));
      await userEvent.click(menu.getByRole("button", { name: "Share" }));
      await waitFor(() => expect(count).toHaveBeenCalledTimes(3));
      expect(count).toHaveBeenLastCalledWith("share.link");

      // A phone's Share beside Play and Save hands it to the same sheet.
      const head = document.querySelector<HTMLElement>(".list-head__share")!;
      expect(head).toHaveAccessibleName("Share");
      await userEvent.click(head);
      await waitFor(() => expect(count).toHaveBeenCalledTimes(4));
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("counts no share for a clipboard that said no, or a share sheet closed", async () => {
    const count = vi.spyOn(usage, "count");
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(() => Promise.reject(new Error("refused")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = vi.fn(() => Promise.reject(new DOMException("closed", "AbortError")));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      openAs(member);
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getAllByRole("button", { name: "Copy link" })[0]!);
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      await userEvent.click(screen.getByLabelText("More about this list"));
      const menu = within(screen.getByLabelText("More about this list").closest("details")!);
      await userEvent.click(menu.getByRole("button", { name: "Share" }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      expect(count).not.toHaveBeenCalledWith("share.link");
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("finishes Mine when every card of a list of five has a tier, not before", async () => {
    const step = vi.spyOn(usage, "step");
    mocks.loadList.mockResolvedValue({ ...fivePlaced, items: twoTiers.items });
    open();
    await screen.findByRole("heading", { level: 1 });
    const theirs = screen.getByRole("region", { name: "Their ranking" });
    await userEvent.click(within(theirs).getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("2");
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    // Three cards, all placed: too few to finish.
    expect(step).not.toHaveBeenCalledWith("full_list");
    cleanup();
    localStorage.clear();

    mocks.loadList.mockResolvedValue(fivePlaced);
    open();
    await screen.findByRole("heading", { level: 1 });
    const five = screen.getByRole("region", { name: "Their ranking" });
    await userEvent.click(within(five).getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("2");
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    expect(step).toHaveBeenCalledWith("full_list");
  });

  it("finishes Mine at the move that places its last card", async () => {
    const step = vi.spyOn(usage, "step");
    // Mine begun here: four of the five placed, Alien still in the pool.
    saveDraft(localStorageStore, scopeOf(fivePlaced), [
      [0, 2],
      [1, 3],
    ]);
    mocks.loadList.mockResolvedValue(fivePlaced);
    open();
    await screen.findByRole("heading", { level: 1 });
    const yours = screen.getByRole("region", { name: "Your ranking" });
    expect(step).not.toHaveBeenCalledWith("full_list");
    await userEvent.click(within(yours).getByRole("button", { name: "Alien" }));
    await userEvent.keyboard("1");
    await waitFor(() => expect(step).toHaveBeenCalledWith("full_list"));
  });
});
