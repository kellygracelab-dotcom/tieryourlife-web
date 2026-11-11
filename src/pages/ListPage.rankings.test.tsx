import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type InitialEntry } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankingsPage, ReaderRanking } from "../api/community";
import { ApiFailure } from "../api/errors";
import type { PublishedList } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { memoryStore } from "../lib/storage";

const mocks = vi.hoisted(() => ({
  loadList: vi.fn<(id: string) => Promise<PublishedList>>(),
  loadListRankings: vi.fn<(id: string, after: string | null) => Promise<RankingsPage>>(),
  withdrawListRanking: vi.fn<(id: string) => Promise<void>>(),
  keepRanking: vi.fn(() => new Promise<never>(() => undefined)),
  keepListRanking:
    vi.fn<
      (
        list: Pick<PublishedList, "id" | "items" | "tiers">,
        rows: readonly (readonly number[])[],
      ) => Promise<ReaderRanking & { created?: boolean }>
    >(),
  loadListAsWritten: vi.fn<(id: string) => Promise<PublishedList>>(),
  signIn: vi.fn(async () => ({ kind: "cancelled" as const })),
}));
vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  keepRanking: mocks.keepRanking,
  loadList: mocks.loadList,
  loadListRankings: mocks.loadListRankings,
  withdrawListRanking: mocks.withdrawListRanking,
  keepListRanking: mocks.keepListRanking,
  loadListAsWritten: mocks.loadListAsWritten,
  followState: vi.fn(async () => ({ following: false, followers: 0 })),
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
  takeCount: 40,
  rankingCount: 12,
  tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: null },
  ],
};

const reader = (uid: string, name: string, extra: Partial<ReaderRanking> = {}): ReaderRanking => ({
  uid,
  authorName: name,
  authorPhotoUrl: null,
  // The Witch where the author left a gap, under a word of the reader's own.
  // Kept before the order inside a tier was: no rows, the arrangement is read.
  arrangement: [null, 0],
  rows: [],
  tierLabels: ["Best"],
  updatedAtMs: Date.now(),
  mine: false,
  ...extra,
});

const me = reader("u9", "Reader", { mine: true, arrangement: [0, 0], tierLabels: [] });
const olena = reader("u5", "olena");

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u9",
  displayName: "Reader",
  photoUrl: null,
};

const openAs = (account: Session["account"] = member, entries: InitialEntry[] = ["/l/abc"]) => {
  const router = createMemoryRouter(routes, {
    initialEntries: entries,
    initialIndex: entries.length - 1,
  });
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: mocks.signIn,
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return router;
};

/** Who ranked the list is a line of the ⋮ menu, the one place the number is said. */
const openSheet = async () => {
  await userEvent.click(await screen.findByLabelText("More about this list"));
  await userEvent.click(screen.getByRole("button", { name: "Rankings · 12" }));
  return screen.getByRole("dialog", { name: "Rankings" });
};

/** Each row's words, in order: the name, its pill, its button. */
const rowsOf = (sheet: HTMLElement) =>
  within(sheet)
    .getAllByRole("listitem")
    .map((row) =>
      [...row.querySelectorAll(".rankings__name-text, .rankings__pill, .rankings__withdraw")]
        .map((part) => part.textContent)
        .join(" "),
    );

const whose = () => screen.getByRole("group", { name: "Whose arrangement to show" });

/** The switch once the list has opened. */
const opened = async () =>
  within(await screen.findByRole("group", { name: "Whose arrangement to show" }));

beforeEach(() => {
  mocks.loadList.mockReset();
  mocks.loadList.mockResolvedValue(list);
  mocks.loadListRankings.mockReset();
  mocks.loadListRankings.mockResolvedValue({ rankings: [me, olena], nextCursor: null });
  mocks.withdrawListRanking.mockReset();
  mocks.withdrawListRanking.mockResolvedValue(undefined);
  mocks.keepListRanking.mockReset();
  mocks.keepListRanking.mockResolvedValue({ ...me, rows: [[0, 1]], created: true });
  mocks.loadListAsWritten.mockReset();
  mocks.loadListAsWritten.mockResolvedValue(list);
  mocks.signIn.mockClear();
  useHiddenStoreForTests(memoryStore());
});

describe("ListPage rankings", () => {
  it("lists the author with a pill, then you with Withdraw, then everyone else, under a title without a number", async () => {
    openAs();
    const sheet = await openSheet();
    // The title cannot disagree with the menu's line: it has no number of its own.
    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent(/^Rankings$/);
    expect(await within(sheet).findByRole("button", { name: /^olena/ })).toBeInTheDocument();
    expect(mocks.loadListRankings).toHaveBeenCalledWith("abc", null);
    expect(rowsOf(sheet)).toEqual(["danylo Author", "You Withdraw", "olena"]);
    // The author's is the one on the board.
    expect(within(sheet).getByRole("button", { name: /^danylo/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(sheet).getByRole("button", { name: "Withdraw" })).toHaveClass(
      "rankings__withdraw",
    );
  });

  it("shows a reader's placing in the left half, by name, and the cross goes back to the author's", async () => {
    openAs();
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("button", { name: /^olena/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The sheet came from the menu, which closed behind it: its button has the focus back.
    expect(screen.getByLabelText("More about this list")).toHaveFocus();

    const left = within(whose()).getByRole("button", { name: "olena" });
    expect(left).toHaveAttribute("aria-pressed", "true");
    const board = screen.getByRole("region", { name: "olena" });
    // Their tier word, their placing: The Witch where the author had nothing.
    expect(within(board).getByRole("list", { name: "Best" })).toHaveTextContent("The Witch");
    expect(board).not.toHaveTextContent("Ex Machina");

    // The sheet remembers whose is on the board and does not ask again.
    const again = await openSheet();
    expect(within(again).getByRole("button", { name: /^olena/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(mocks.loadListRankings).toHaveBeenCalledTimes(1);
    await userEvent.click(within(again).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(
      within(whose()).getByRole("button", { name: "Back to the author’s ranking" }),
    );
    expect(within(whose()).getByRole("button", { name: "Theirs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("region", { name: "Their ranking" })).toHaveTextContent("Ex Machina");
  });

  it("shows a reader's cards in the order they left them inside a tier", async () => {
    mocks.loadListRankings.mockResolvedValue({
      rankings: [reader("u5", "olena", { arrangement: [0, 0], rows: [[1, 0]] })],
      nextCursor: null,
    });
    openAs();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    const best = within(screen.getByRole("region", { name: "olena" })).getByRole("list", {
      name: "Best",
    });
    expect(
      within(best)
        .getAllByRole("button")
        .map((card) => card.getAttribute("aria-label") ?? card.textContent),
    ).toEqual(["The Witch", "Ex Machina"]);
  });

  it("starts Mine from a reader's placing when a card is moved on it", async () => {
    localStorage.clear();
    mocks.loadList.mockResolvedValue({
      ...list,
      tiers: [
        ...list.tiers,
        { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
      ],
    });
    mocks.loadListRankings.mockResolvedValue({
      rankings: [reader("u5", "olena", { tierLabels: ["Best", "Fine"] })],
      nextCursor: null,
    });
    openAs();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    const board = screen.getByRole("region", { name: "olena" });
    await userEvent.click(within(board).getByRole("button", { name: "The Witch" }));
    // Her words for the tiers on her board.
    await userEvent.click(screen.getByRole("button", { name: "Place The Witch in Fine" }));
    // Her placing, The Witch moved, in Mine: Ex Machina, which she left out, waits in the pool.
    // Mine is what was on screen, her tier words included, as in the app.
    const yours = screen.getByRole("region", { name: "Your ranking" });
    expect(within(yours).getByRole("list", { name: "Fine" })).toHaveTextContent("The Witch");
    expect(within(yours).getByRole("list", { name: "Best" })).not.toHaveTextContent("Ex Machina");
    expect(within(yours).queryByRole("list", { name: "A" })).toBeNull();
    expect(screen.getByText("Your version starts from olena’s ranking")).toBeInTheDocument();

    // Finish keeps her words with the ranking.
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(mocks.keepRanking).toHaveBeenCalledWith("abc", [[], [1]], 0, ["Best", "Fine"]);
    localStorage.clear();
  });

  it("keeps a reader's tier words in Mine on the next visit", async () => {
    localStorage.clear();
    mocks.loadList.mockResolvedValue({
      ...list,
      tiers: [
        ...list.tiers,
        { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
      ],
    });
    mocks.loadListRankings.mockResolvedValue({
      rankings: [reader("u5", "olena", { tierLabels: ["", "Fine"] })],
      nextCursor: null,
    });
    openAs();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    const board = screen.getByRole("region", { name: "olena" });
    await userEvent.click(within(board).getByRole("button", { name: "The Witch" }));
    await userEvent.click(screen.getByRole("button", { name: "Place The Witch in Fine" }));
    cleanup();

    // Begun here, the page opens on Mine.
    openAs();
    const yours = await screen.findByRole("region", { name: "Your ranking" });
    // A tier she left without a word keeps the list's.
    expect(within(yours).getByRole("list", { name: "S" })).toBeInTheDocument();
    expect(within(yours).getByRole("list", { name: "Fine" })).toHaveTextContent("The Witch");
    localStorage.clear();
  });

  it("goes back to the author's from the sheet's first row, and Mine stays a press away", async () => {
    openAs();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    await userEvent.click(within(whose()).getByRole("button", { name: "Mine" }));
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    // Theirs is still olena's until the author's is chosen again.
    expect(within(whose()).getByRole("button", { name: "olena" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(within(await openSheet()).getByRole("button", { name: /^danylo/ }));
    expect(screen.getByRole("region", { name: "Their ranking" })).toBeInTheDocument();
  });

  it("asks before withdrawing one's own, in the sheet, and takes it down", async () => {
    openAs();
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Withdraw" }));
    const ask = within(sheet).getByRole("group", { name: "Withdraw your ranking?" });
    expect(ask).toHaveTextContent("It leaves this list’s rankings.");
    expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(within(sheet).queryByRole("group", { name: "Withdraw your ranking?" })).toBeNull();
    expect(mocks.withdrawListRanking).not.toHaveBeenCalled();

    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      within(within(sheet).getByRole("group")).getByRole("button", { name: "Withdraw" }),
    );
    expect(mocks.withdrawListRanking).toHaveBeenCalledWith("abc");
    expect(rowsOf(sheet)).toEqual(["danylo Author", "olena"]);
    expect(within(sheet).queryByRole("alert")).toBeNull();
  });

  it("puts one's own back and says so when the withdrawal does not go through", async () => {
    mocks.withdrawListRanking.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    openAs();
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      within(within(sheet).getByRole("group")).getByRole("button", { name: "Withdraw" }),
    );
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Couldn’t withdraw your ranking. Try again.",
    );
    expect(rowsOf(sheet)[1]).toBe("You Withdraw");
  });

  it("shows the author's again when the placing on the board is the one withdrawn", async () => {
    openAs();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^You/ }));
    expect(screen.getByRole("region", { name: "Reader" })).toBeInTheDocument();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      within(within(sheet).getByRole("group")).getByRole("button", { name: "Withdraw" }),
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("region", { name: "Their ranking" })).toBeInTheDocument();
  });

  it("reads everyone else a page at a time, and leaves out what is nobody's", async () => {
    mocks.loadListRankings
      .mockResolvedValueOnce({
        rankings: [
          olena,
          // An /r/ ranking from the same shelf: no reader, no name.
          {
            updatedAtMs: 5,
            arrangement: [],
            tierLabels: [],
            mine: false,
          } as unknown as ReaderRanking,
        ],
        nextCursor: "abc_u5",
      })
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce({ rankings: [olena, reader("u6", "maks")], nextCursor: null });
    openAs();
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Show more" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Could not load more.");
    // Never disabled while it loads, so the keyboard is still on it after a failure.
    expect(within(sheet).getByRole("button", { name: "Show more" })).toHaveFocus();
    await userEvent.click(within(sheet).getByRole("button", { name: "Show more" }));
    expect(await within(sheet).findByRole("button", { name: /^maks/ })).toBeInTheDocument();
    // The page's first new reader takes the focus; the button is gone with the last page.
    expect(within(sheet).getByRole("button", { name: /^maks/ })).toHaveFocus();
    expect(mocks.loadListRankings).toHaveBeenLastCalledWith("abc", "abc_u5");
    // olena came twice and is listed once; the shelf's stray is not listed at all.
    expect(rowsOf(sheet)).toHaveLength(3);
    expect(within(sheet).queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says when the rankings could not be read, and tries again", async () => {
    mocks.loadListRankings
      .mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }))
      .mockResolvedValueOnce({ rankings: [olena], nextCursor: null });
    openAs();
    const sheet = await openSheet();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Couldn’t load the rankings.",
    );
    // The author's row is there whatever the backend says.
    expect(rowsOf(sheet)).toHaveLength(1);
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(await within(sheet).findByRole("button", { name: /^olena/ })).toBeInTheDocument();
  });

  it("shows a reader's placing on a list its author never arranged, and goes back to Mine", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      items: list.items.map((item) => ({ ...item, tierIndex: null })),
    });
    openAs();
    await screen.findByRole("region", { name: "Your ranking" });
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    expect(within(whose()).getByRole("button", { name: "olena" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Two halves, so Save asks, and offers the reader's placing by name.
    await userEvent.click(screen.getAllByRole("button", { name: "Save to my lists" })[0]!);
    const asking = screen.getByRole("dialog", { name: "Which ranking to save?" });
    expect(within(asking).getByRole("button", { name: "olena" })).toBeInTheDocument();
    await userEvent.click(within(asking).getByRole("button", { name: "Cancel" }));

    await userEvent.click(
      within(whose()).getByRole("button", { name: "Back to the author’s ranking" }),
    );
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    // One half again: a template is saved as one's own without a question.
    await userEvent.click(screen.getAllByRole("button", { name: "Save to my lists" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Saved to your lists.")).toBeInTheDocument();
  });

  it("names nobody in the first row of an editorial list", async () => {
    mocks.loadList.mockResolvedValue({
      ...list,
      authorUid: "85RRieyLyUPCEqHjdYCdxVlWxHx2",
      authorName: "Danylo Petrov",
    });
    openAs();
    const sheet = await openSheet();
    await within(sheet).findByRole("button", { name: /^olena/ });
    expect(rowsOf(sheet)[0]).toBe("Author");
    expect(sheet).not.toHaveTextContent("Danylo");
  });

  it("lets the author look at a reader's placing of their list, with no Mine to switch to", async () => {
    openAs({ kind: "signedIn", uid: "u1", displayName: "danylo", photoUrl: null });
    expect(await screen.findByRole("region", { name: "Your list" })).toBeInTheDocument();
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    expect(within(whose()).getByRole("button", { name: "olena" })).toBeInTheDocument();
    expect(within(whose()).queryByRole("button", { name: "Mine" })).toBeNull();
    expect(screen.getByRole("region", { name: "olena" })).toHaveTextContent("The Witch");
    await userEvent.click(
      within(whose()).getByRole("button", { name: "Back to the author’s ranking" }),
    );
    expect(screen.getByRole("region", { name: "Your list" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
  });
  it("says Someone for a reader with no name, and draws a letter or a figure where a photo cannot be", async () => {
    mocks.loadListRankings.mockResolvedValue({
      rankings: [
        reader("u1x", "", { authorPhotoUrl: "" }),
        reader("u2x", "   "),
        reader("u3x", "Anonymous"),
        reader("u4x", "😀 emoji"),
        reader("u5x", "lost face", { authorPhotoUrl: "https://lh3.example/expired" }),
      ],
      nextCursor: null,
    });
    openAs();
    const sheet = await openSheet();
    await within(sheet).findByRole("button", { name: /^lost face/ });
    expect(rowsOf(sheet).slice(1)).toEqual([
      "Someone",
      "Someone",
      "Someone",
      "😀 emoji",
      "lost face",
    ]);
    // An empty address is no picture at all.
    expect(sheet.querySelector('img[src=""]')).toBeNull();
    const emoji = within(sheet).getByRole("button", { name: /emoji/ });
    expect(emoji.querySelector(".rankings__face--initial")).toHaveTextContent(/^😀$/);
    const lost = within(sheet).getByRole("button", { name: /^lost face/ });
    fireEvent.error(lost.querySelector("img")!);
    expect(lost.querySelector("img")).toBeNull();
    expect(lost.querySelector(".rankings__face--initial")).toHaveTextContent("L");

    await userEvent.click(within(sheet).getAllByRole("button", { name: /^Someone/ })[2]!);
    expect(within(whose()).getByRole("button", { name: "Someone" })).toBeInTheDocument();
  });

  it("says a failed withdrawal next to the row that came back", async () => {
    mocks.withdrawListRanking.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    openAs();
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      within(within(sheet).getByRole("group")).getByRole("button", { name: "Withdraw" }),
    );
    const said = await within(sheet).findByRole("alert");
    const rows = within(sheet).getAllByRole("listitem");
    // Right under You, before everyone else.
    expect(rows[1]).toHaveTextContent(/You.*Withdraw/);
    expect(rows[2]).toContainElement(said);
  });

  it("closes the sheet on Back and stays on the list, as the app's back does", async () => {
    const router = openAs(member, ["/", "/l/abc"]);
    await openSheet();
    await act(() => router.navigate(-1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.state.location.pathname).toBe("/l/abc");
    // With the sheet closed, Back leaves the list as before.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps the reader chosen through Back, Forward and a reload", async () => {
    const router = openAs(member, ["/", "/l/abc"]);
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    expect(router.state.location.pathname).toBe("/l/abc");
    expect(router.state.historyAction).toBe("REPLACE");

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/");
    await act(() => router.navigate(1));
    expect((await opened()).getByRole("button", { name: "olena" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("region", { name: "olena" })).toHaveTextContent("The Witch");

    // A reload starts afresh from the entry's state.
    const kept = router.state.location.state;
    cleanup();
    const reloaded = openAs(member, [{ pathname: "/l/abc", state: kept }]);
    expect((await opened()).getByRole("button", { name: "olena" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Not one page of rankings had to be read again for it.
    expect(mocks.loadListRankings).toHaveBeenCalledTimes(1);

    // Back to the author's, and the entry forgets the reader.
    await userEvent.click(
      within(whose()).getByRole("button", { name: "Back to the author’s ranking" }),
    );
    cleanup();
    openAs(member, [{ pathname: "/l/abc", state: reloaded.state.location.state }]);
    expect((await opened()).getByRole("button", { name: "Theirs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not bring back a reader chosen on the list before it was republished", async () => {
    const router = openAs(member, ["/l/abc"]);
    await userEvent.click(await within(await openSheet()).findByRole("button", { name: /^olena/ }));
    const kept = router.state.location.state;
    cleanup();
    mocks.loadList.mockResolvedValue({ ...list, updatedAt: 5 });
    openAs(member, [{ pathname: "/l/abc", state: kept }]);
    expect((await opened()).getByRole("button", { name: "Theirs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens again at the reader chosen further down", async () => {
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      openAs();
      await userEvent.click(
        await within(await openSheet()).findByRole("button", { name: /^olena/ }),
      );
      scrolled.length = 0;
      const again = await openSheet();
      expect(scrolled).toEqual([within(again).getByRole("button", { name: /^olena/ })]);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});

describe("ListPage: showing one's ranking to others", () => {
  const twoTiers: PublishedList = {
    ...list,
    tiers: [
      ...list.tiers,
      { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
    ],
  };
  beforeEach(() => {
    mocks.loadList.mockResolvedValue(twoTiers);
    mocks.loadListAsWritten.mockResolvedValue(twoTiers);
  });
  /** Ex Machina moved to A on the author's board: Mine starts from it, as on the phone. */
  const arrangeMine = async () => {
    const board = await screen.findByRole("region", { name: "Their ranking" });
    await userEvent.click(within(board).getByRole("button", { name: "Ex Machina" }));
    await userEvent.click(screen.getByRole("button", { name: "Place Ex Machina in A" }));
    await screen.findByRole("region", { name: "Your ranking" });
  };
  const menu = async () => {
    await userEvent.click(await screen.findByLabelText("More about this list"));
  };

  it("keeps the personal board and publishes exactly once after explicitly choosing the progress offer", async () => {
    localStorage.clear();
    openAs();
    await arrangeMine();
    const offer = await screen.findByRole("complementary", { name: "Share your ranking?" });
    expect(mocks.keepListRanking).not.toHaveBeenCalled();
    await userEvent.click(within(offer).getByRole("button", { name: "Show in Rankings" }));
    expect(await screen.findByText("Your ranking is in the list’s rankings")).toBeInTheDocument();
    expect(mocks.keepListRanking).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "abc" }),
      [[], [0]],
    );
    cleanup();
    openAs();
    await screen.findByRole("region", { name: "Your ranking" });
    expect(screen.queryByRole("complementary", { name: "Share your ranking?" })).toBeNull();
    localStorage.clear();
  });

  it("is not offered before Mine is arranged", async () => {
    localStorage.clear();
    openAs();
    await menu();
    expect(screen.queryByRole("button", { name: "Show my ranking to others" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in to show your ranking" })).toBeNull();
  });

  it("puts Mine among the list's rankings from the menu, as the app's Show my ranking does", async () => {
    localStorage.clear();
    openAs();
    await arrangeMine();
    await menu();
    await userEvent.click(screen.getByRole("button", { name: "Show my ranking to others" }));
    expect(await screen.findByText("Your ranking is in the list’s rankings")).toBeInTheDocument();
    // The list is read again first: rows name cards by their place in it.
    expect(mocks.loadListAsWritten).toHaveBeenCalledWith("abc");
    expect(mocks.keepListRanking).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "abc", tiers: twoTiers.tiers }),
      [[], [0]],
    );
    // One more reader counted, and the sheet leads with one's own.
    await userEvent.click(await screen.findByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Rankings · 13" }));
    const sheet = screen.getByRole("dialog", { name: "Rankings" });
    expect(await within(sheet).findByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    localStorage.clear();
  });

  // QA W51: Show, Withdraw, Show again said 13, 13, 14 while the server had 13, 12, 13.
  it("counts one's own once through Show, Withdraw and Show again", async () => {
    localStorage.clear();
    openAs();
    await arrangeMine();
    const show = async () => {
      await menu();
      await userEvent.click(screen.getByRole("button", { name: "Show my ranking to others" }));
      expect(await screen.findByText("Your ranking is in the list’s rankings")).toBeInTheDocument();
    };
    await show();
    await menu();
    await userEvent.click(screen.getByRole("button", { name: "Rankings · 13" }));
    const sheet = screen.getByRole("dialog", { name: "Rankings" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Withdraw" }));
    await userEvent.click(
      within(within(sheet).getByRole("group")).getByRole("button", { name: "Withdraw" }),
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await menu();
    expect(screen.getByRole("button", { name: "Rankings · 12" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await show();
    await menu();
    expect(screen.getByRole("button", { name: "Rankings · 13" })).toBeInTheDocument();
    localStorage.clear();
  });

  it("asks a guest to sign in instead", async () => {
    localStorage.clear();
    openAs({ kind: "guest", uid: "g1" });
    await arrangeMine();
    await menu();
    await userEvent.click(screen.getByRole("button", { name: "Sign in to show your ranking" }));
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.keepListRanking).not.toHaveBeenCalled();
    localStorage.clear();
  });

  it("sends nothing when the author changed the list since, and says why", async () => {
    localStorage.clear();
    mocks.loadListAsWritten.mockResolvedValue({ ...twoTiers, updatedAt: 5 });
    openAs();
    await arrangeMine();
    await menu();
    await userEvent.click(screen.getByRole("button", { name: "Show my ranking to others" }));
    expect(
      await screen.findByText(
        "The author changed this list while you were ranking it. Load it again to rank it as it is now.",
      ),
    ).toBeInTheDocument();
    expect(mocks.keepListRanking).not.toHaveBeenCalled();
    localStorage.clear();
  });

  it("says why a banned reader cannot show it", async () => {
    localStorage.clear();
    mocks.keepListRanking.mockRejectedValue(new ApiFailure({ kind: "banned", until: null }));
    openAs();
    await arrangeMine();
    await menu();
    await userEvent.click(screen.getByRole("button", { name: "Show my ranking to others" }));
    expect(
      await screen.findByText(
        "A moderator took down one of your lists, so you cannot show rankings for now.",
      ),
    ).toBeInTheDocument();
    localStorage.clear();
  });
});
