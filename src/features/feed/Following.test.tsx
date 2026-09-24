import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { SessionContext, type Session } from "../../app/session";
import { HomePage } from "../../pages/HomePage";
import { memoryStore } from "../board/draft";
import { useHiddenStoreForTests } from "../community/useHidden";
import { keepFeedSource, readFeedSource } from "./feedSource";
import type { Follow, LoadSuggestions } from "./Following";

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

const open = (account: Session["account"] = member) => {
  const routes: RouteObject[] = [
    {
      path: "/",
      element: (
        <HomePage
          load={load}
          loadSuggestions={loadSuggestions}
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
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "New from people you follow",
    );
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

  it("shows a guest Everyone only, without the switch", async () => {
    open({ kind: "guest", uid: "g1" });
    expect(await screen.findByRole("link", { name: /List p1/ })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Whose lists to show" })).toBeNull();
  });
});
