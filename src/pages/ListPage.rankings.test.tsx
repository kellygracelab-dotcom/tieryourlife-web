import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
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
}));
vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  loadList: mocks.loadList,
  loadListRankings: mocks.loadListRankings,
  withdrawListRanking: mocks.withdrawListRanking,
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
  takeCount: 12,
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
  arrangement: [null, 0],
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

const openAs = (account: Session["account"] = member) =>
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/l/abc"] })} />
    </SessionContext.Provider>,
  );

const openSheet = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "12 rankings" }));
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

beforeEach(() => {
  mocks.loadList.mockReset();
  mocks.loadList.mockResolvedValue(list);
  mocks.loadListRankings.mockReset();
  mocks.loadListRankings.mockResolvedValue({ rankings: [me, olena], nextCursor: null });
  mocks.withdrawListRanking.mockReset();
  mocks.withdrawListRanking.mockResolvedValue(undefined);
  useHiddenStoreForTests(memoryStore());
});

describe("ListPage rankings", () => {
  it("lists the author with a pill, then you with Withdraw, then everyone else, under a title without a number", async () => {
    openAs();
    const sheet = await openSheet();
    // The title cannot disagree with the chip: it has no number of its own.
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
    await userEvent.click(within(sheet).getByRole("button", { name: "Show more" }));
    expect(await within(sheet).findByRole("button", { name: /^maks/ })).toBeInTheDocument();
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
    await userEvent.click(
      within(whose()).getByRole("button", { name: "Back to the author’s ranking" }),
    );
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
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
});
