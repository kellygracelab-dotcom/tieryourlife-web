import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Following } from "../../api/community";
import { ApiFailure } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { SessionContext, type Session } from "../../app/session";
import { memoryStore } from "../../lib/storage";
import { HomePage, type HomeTab } from "../../pages/HomePage";
import { useHiddenStoreForTests } from "../community/useHidden";
import { createSectionsStore, type SectionsDeps } from "../sections/useSections";
import type { Follow, LoadFollowing, LoadSuggestions } from "./Following";

vi.mock("../../lib/api", async () => ({
  ...(await import("../../test/apiMock")).apiStubs(),
  loadReports: vi.fn(() => new Promise(() => undefined)),
  followState: vi.fn(() => new Promise(() => undefined)),
}));

const list = (id: string, more: Partial<ListSummary> = {}): ListSummary => ({
  id,
  title: `List ${id}`,
  authorUid: "u2",
  authorName: "someone",
  authorPhotoUrl: null,
  category: "games",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 5,
  ...more,
});

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 4,
  followerCount: 2,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

const NINE = ["anime", "film_tv", "games", "music", "books", "food", "sport", "people", "other"];

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
const sectionsDeps = {
  load: vi.fn<SectionsDeps["load"]>(),
  follow: vi.fn<SectionsDeps["follow"]>(),
  unfollow: vi.fn<SectionsDeps["unfollow"]>(),
};

const nobody: Following = { authors: [], topics: [], sections: [] };

const open = (account: Session["account"] = member, tab: HomeTab = "following") => {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const page = (which: HomeTab) => (
    <HomePage
      tab={which}
      load={load}
      loadSuggestions={loadSuggestions}
      loadFollowing={loadFollowing}
      follow={follow}
      unfollow={unfollow}
      store={store}
    />
  );
  const routes: RouteObject[] = [
    { path: "/", element: page("explore") },
    { path: "/following", element: page("following") },
    { path: "/following/manage", element: <h1>Manage page</h1> },
    { path: "/u/:uid", element: <h1>Profile page</h1> },
    { path: "/s/:id", element: <h1>Section page</h1> },
    { path: "/s/:id/t/:topic", element: <h1>Topic page</h1> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [tab === "following" ? "/following" : "/"],
  });
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return { router, store };
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
      { uid: "85RRieyLyUPCEqHjdYCdxVlWxHx2", name: "TierYourLife", photoUrl: null, takeCount: 99 },
    ],
  });
  loadFollowing.mockReset();
  loadFollowing.mockResolvedValue(nobody);
  follow.mockReset();
  follow.mockResolvedValue(undefined);
  unfollow.mockReset();
  unfollow.mockResolvedValue(undefined);
  sectionsDeps.load.mockReset();
  sectionsDeps.load.mockResolvedValue({ sections: NINE.map((id) => stats(id)) });
  sectionsDeps.follow.mockReset();
  sectionsDeps.follow.mockResolvedValue({ following: true });
  sectionsDeps.unfollow.mockReset();
  useHiddenStoreForTests(memoryStore());
});

describe("the Following tab", () => {
  it("is a tab of its own address beside Explore, for a signed-in person", async () => {
    const { router } = open(member, "explore");
    const tabs = within(screen.getByRole("navigation", { name: "Community" }));
    expect(tabs.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(tabs.getByRole("link", { name: "Following" }));
    expect(router.state.location.pathname).toBe("/following");
    expect(load).toHaveBeenLastCalledWith({ following: true, sort: "recent" });
  });

  it("offers the sections to follow and people worth following while nothing is followed", async () => {
    open();
    expect(await screen.findByText("You aren't following anything yet")).toBeInTheDocument();
    const followGames = await screen.findByRole("button", { name: "Follow Games" });
    expect(followGames).toHaveAttribute("aria-pressed", "false");
    // An editorial account is nobody to follow: its lists stand without an author.
    expect(await screen.findByText("someone")).toBeInTheDocument();
    expect(screen.queryByText("TierYourLife")).toBeNull();

    await userEvent.click(followGames);
    expect(sectionsDeps.follow).toHaveBeenCalledWith("games");
    // Following something turns the tab into its feed, with the section in the strip.
    const strip = within(await screen.findByRole("navigation", { name: "Following" }));
    expect(strip.getByRole("link", { name: /Games/ })).toHaveAttribute("href", "/s/games");
    expect(load).toHaveBeenLastCalledWith({ following: true, sort: "recent" });
  });

  it("shows what is followed in a strip, and why each list is in the feed", async () => {
    sectionsDeps.load.mockResolvedValue({
      sections: NINE.map((id) => stats(id, { following: id === "anime" })),
    });
    loadFollowing.mockResolvedValue({
      authors: [{ uid: "u7", name: "kenji", photoUrl: null }],
      topics: [
        {
          id: "t1",
          name: "Pokémon",
          section: "games",
          status: "approved",
          listCount: 3,
          followerCount: 9,
          following: true,
          createdBy: "u9",
          mergedInto: null,
        },
      ],
      sections: [{ id: "anime", followerCount: 3 }],
    });
    load.mockImplementation(async (query) =>
      query.following
        ? {
            lists: [
              list("a", { category: "anime", title: "Ghibli, ranked" }),
              list("b", { topicId: "t1", title: "Starters" }),
              list("c", { authorUid: "u7", category: "anime", title: "Kenji's own" }),
            ],
            nextCursor: null,
          }
        : { lists: [], nextCursor: null },
    );
    open();

    const strip = within(await screen.findByRole("navigation", { name: "Following" }));
    expect(await strip.findByRole("link", { name: /Anime/ })).toHaveAttribute("href", "/s/anime");
    expect(strip.getByRole("link", { name: /Pokémon/ })).toHaveAttribute("href", "/s/games/t/t1");
    expect(strip.getByRole("link", { name: /kenji/ })).toHaveAttribute("href", "/u/u7");
    expect(strip.getByRole("link", { name: /Manage/ })).toHaveAttribute(
      "href",
      "/following/manage",
    );

    expect(await screen.findByRole("link", { name: /Ghibli, ranked/ })).toHaveTextContent(
      "In Anime",
    );
    expect(screen.getByRole("link", { name: /Starters/ })).toHaveTextContent("Pokémon");
    // A person followed needs no line: their face is on the card.
    expect(screen.getByRole("link", { name: /Kenji's own/ })).not.toHaveTextContent("In Anime");
  });

  it("says when what is followed has published nothing, and leads back to Explore", async () => {
    loadFollowing.mockResolvedValue({
      ...nobody,
      authors: [{ uid: "u7", name: "kenji", photoUrl: null }],
    });
    load.mockImplementation(async () => ({ lists: [], nextCursor: null }));
    open();
    expect(
      await screen.findByText("Nobody you follow has published anything yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Explore" })).toHaveAttribute("href", "/");
  });

  it("names a feed that would not load, and tries again", async () => {
    load.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your feed.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You aren't following anything yet")).toBeInTheDocument();
  });

  it("is not a guest's: no tabs, and its address leads to Explore", async () => {
    const { router } = open({ kind: "guest", uid: null });
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByRole("navigation", { name: "Community" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Popular this week" })).toBeInTheDocument();
  });
});
