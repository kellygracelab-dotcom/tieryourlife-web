import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { SessionContext, type Session } from "../../app/session";
import { memoryStore } from "../../lib/storage";
import { HomePage } from "../../pages/HomePage";
import { useHiddenStoreForTests } from "../community/useHidden";
import { keepFeedSource, readFeedSource } from "./feedSource";
import type { Follow, LoadFollowing, LoadSuggestions } from "./Following";

vi.mock("../../lib/api", () => ({
  loadReports: vi.fn(() => new Promise(() => undefined)),
  followState: vi.fn(() => new Promise(() => undefined)),
  unfollowAuthor: vi.fn(),
  loadFeed: vi.fn(),
  followAuthor: vi.fn(),
  suggestedAuthors: vi.fn(),
  report: vi.fn(),
}));

const list = (id: string): ListSummary => ({
  id,
  title: `List ${id}`,
  authorUid: "u2",
  authorName: "someone",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 5,
});

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const load = vi.fn<(query: FeedQuery) => Promise<FeedPage>>();
const loadSuggestions = vi.fn<LoadSuggestions>();
const follow = vi.fn<Follow>();
const unfollow = vi.fn<Follow>();
const loadFollowing = vi.fn<LoadFollowing>();

const open = (account: Session["account"] = member) => {
  const routes: RouteObject[] = [
    {
      path: "/",
      element: (
        <HomePage
          load={load}
          loadSuggestions={loadSuggestions}
          loadFollowing={loadFollowing}
          follow={follow}
          unfollow={unfollow}
        />
      ),
    },
    { path: "/u/:uid", element: <h1>Profile page</h1> },
  ];
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </SessionContext.Provider>,
  );
};

beforeEach(() => {
  localStorage.clear();
  load.mockReset();
  load.mockImplementation(async (query) =>
    query.following
      ? { lists: [], nextCursor: null, followingNobody: true }
      : { lists: [list("p1")], nextCursor: null },
  );
  loadSuggestions.mockReset();
  loadSuggestions.mockResolvedValue({
    authors: [
      { uid: "u2", name: "someone", photoUrl: null, takeCount: 12 },
      { uid: "u3", name: "other", photoUrl: "https://img/f.jpg", takeCount: 3 },
    ],
  });
  loadFollowing.mockReset();
  loadFollowing.mockResolvedValue({ authors: [] });
  follow.mockReset();
  follow.mockResolvedValue(undefined);
  unfollow.mockReset();
  unfollow.mockResolvedValue(undefined);
  useHiddenStoreForTests(memoryStore());
});

describe("feed source", () => {
  it("is Everyone until chosen, and is kept per account on the device", () => {
    const store = memoryStore();
    expect(readFeedSource("u1", store.read)).toBe("everyone");
    keepFeedSource("u1", "following", store.write);
    expect(readFeedSource("u1", store.read)).toBe("following");
    expect(readFeedSource("u2", store.read)).toBe("everyone");
  });
});

describe("HomePage for a signed-in person", () => {
  it("offers Everyone and Following, and following nobody brings people worth following", async () => {
    open();
    expect(await screen.findByRole("link", { name: /List p1/ })).toBeInTheDocument();
    const source = screen.getByRole("radiogroup", { name: "Whose lists to show" });
    await userEvent.click(within(source).getByRole("radio", { name: "Following" }));
    expect(load).toHaveBeenCalledWith({ following: true, sort: "recent" });
    expect(await screen.findByText("You aren’t following anyone")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "New from people you follow" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("tyl:feed-source:u1")).toBe("following");

    const people = await screen.findByRole("list", { name: undefined });
    const cards = within(
      screen.getByRole("heading", { name: "People worth following" }).parentElement!,
    ).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    void people;
    await userEvent.click(within(cards[0]!).getByRole("button", { name: "Follow" }));
    expect(follow).toHaveBeenCalledWith("u2");
    expect(within(cards[0]!).getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(cards[0]!).getByRole("link", { name: /someone/ })).toHaveAttribute(
      "href",
      "/u/u2",
    );

    await userEvent.click(within(cards[0]!).getByRole("button", { name: /Following/ }));
    expect(unfollow).toHaveBeenCalledWith("u2");
    expect(within(cards[0]!).getByRole("button", { name: "Follow" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("leaves an editorial account out of the people worth following", async () => {
    load.mockResolvedValue({ lists: [], nextCursor: null, followingNobody: true });
    loadSuggestions.mockResolvedValue({
      authors: [
        {
          uid: "85RRieyLyUPCEqHjdYCdxVlWxHx2",
          name: "Danylo Petrov",
          photoUrl: null,
          takeCount: 900,
        },
        { uid: "u3", name: "other", photoUrl: null, takeCount: 3 },
      ],
    });
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Following" }));
    expect(await screen.findByRole("link", { name: /other/ })).toBeInTheDocument();
    expect(screen.queryByText(/Danylo Petrov/)).toBeNull();
  });

  it("says when the people followed have published nothing, and leads back to Everyone", async () => {
    load.mockImplementation(async (query) =>
      query.following ? { lists: [], nextCursor: null } : { lists: [list("p1")], nextCursor: null },
    );
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Following" }));
    expect(
      await screen.findByText("Nobody you follow has published anything yet."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See all lists" }));
    expect(await screen.findByRole("link", { name: /List p1/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the lists of the people followed, and names a feed that would not load", async () => {
    load.mockImplementation(async (query) =>
      query.following ? { lists: [list("f1")], nextCursor: null } : { lists: [], nextCursor: null },
    );
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Following" }));
    expect(await screen.findByRole("link", { name: /List f1/ })).toBeInTheDocument();

    load.mockImplementation(async (query) => {
      if (query.following) throw new ApiFailure({ kind: "unavailable" });
      return { lists: [], nextCursor: null };
    });
    localStorage.setItem("tyl:feed-source:u9", "following");
    open({ ...member, uid: "u9" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your feed.");
  });

  it("shows the people followed above their lists, and unfollows from Manage", async () => {
    load.mockImplementation(async (query) =>
      query.following ? { lists: [list("f1")], nextCursor: null } : { lists: [], nextCursor: null },
    );
    loadFollowing.mockResolvedValue({
      authors: [
        { uid: "u2", name: "someone", photoUrl: null },
        { uid: "u3", name: "", photoUrl: "https://img/f.jpg" },
      ],
    });
    unfollow.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Following" }));
    expect(await screen.findByText("You follow 2 people")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /List f1/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Manage" }));
    const dialog = screen.getByRole("dialog", { name: "Following" });
    expect(within(dialog).getByRole("link", { name: "someone" })).toHaveAttribute("href", "/u/u2");
    // A person whose lists are all gone keeps the follow, under "Someone".
    expect(within(dialog).getByRole("link", { name: "Someone" })).toHaveAttribute("href", "/u/u3");
    const reads = load.mock.calls.length;
    const peopleReads = loadFollowing.mock.calls.length;
    const [first] = within(dialog).getAllByRole("listitem");
    await userEvent.click(within(first!).getByRole("button", { name: "Unfollow" }));
    expect(unfollow).toHaveBeenCalledWith("u2");
    expect(within(dialog).queryByRole("link", { name: "someone" })).toBeNull();

    // Done: the strip has dropped whoever the account confirmed, without
    // reading the people again; the feed behind it was read again.
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("You follow 1 person")).toBeInTheDocument();
    expect(load.mock.calls.length).toBeGreaterThan(reads);
    expect(loadFollowing.mock.calls.length).toBe(peopleReads);
    // Manage stayed on the page through the feed's reload, and has the focus back.
    expect(screen.getByRole("button", { name: "Manage" })).toHaveFocus();
  });

  it("brings the row back with a word when unfollowing did not take", async () => {
    load.mockImplementation(async (query) =>
      query.following ? { lists: [list("f1")], nextCursor: null } : { lists: [], nextCursor: null },
    );
    loadFollowing.mockResolvedValue({ authors: [{ uid: "u2", name: "someone", photoUrl: null }] });
    unfollow.mockRejectedValue(new ApiFailure({ kind: "offline" }));
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Following" }));
    await userEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = screen.getByRole("dialog", { name: "Following" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Unfollow" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t follow — try again.",
    );
    expect(within(dialog).getByRole("link", { name: "someone" })).toBeInTheDocument();
    // Escape closes it; nothing changed, so the feed is left alone.
    const reads = load.mock.calls.length;
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(load.mock.calls.length).toBe(reads);
  });

  it("counts an unfollow whose answer arrives after the dialog was closed", async () => {
    load.mockImplementation(async (query) =>
      query.following ? { lists: [list("f1")], nextCursor: null } : { lists: [], nextCursor: null },
    );
    loadFollowing.mockResolvedValue({
      authors: [
        { uid: "u2", name: "someone", photoUrl: null },
        { uid: "u3", name: "other", photoUrl: null },
      ],
    });
    let answer: () => void = () => undefined;
    unfollow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Following" }));
    await userEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = screen.getByRole("dialog", { name: "Following" });
    const [first] = within(dialog).getAllByRole("listitem");
    await userEvent.click(within(first!).getByRole("button", { name: "Unfollow" }));
    // Closed before the account answered: nothing is counted yet.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("You follow 2 people")).toBeInTheDocument();
    const reads = load.mock.calls.length;

    await act(async () => answer());
    expect(await screen.findByText("You follow 1 person")).toBeInTheDocument();
    expect(load.mock.calls.length).toBeGreaterThan(reads);
  });

  it("shows a guest Everyone only, without the switch", async () => {
    open({ kind: "guest", uid: "g1" });
    expect(await screen.findByRole("link", { name: /List p1/ })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Whose lists to show" })).toBeNull();
  });
});
