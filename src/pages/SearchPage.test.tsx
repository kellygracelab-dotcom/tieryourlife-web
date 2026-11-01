import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionStats, Topic } from "../api/sections";
import type { FeedPage, FeedQuery, ListSummary } from "../api/types";
import { routes } from "../app/routes";
import { createSectionsStore } from "../features/sections/useSections";
import { SEARCH_DEBOUNCE_MS, SearchPage } from "./SearchPage";

const mocks = vi.hoisted(() => ({
  loadFeed: vi.fn<(query: FeedQuery) => Promise<FeedPage>>(),
  findTopics: vi.fn<(q: string, section?: string) => Promise<{ topics: Topic[] }>>(),
}));
vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  report: vi.fn(),
  loadFeed: mocks.loadFeed,
  findTopics: mocks.findTopics,
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  claimKept: vi.fn(),
  loadMyRankings: vi.fn(),
  loadMyLists: vi.fn(),
  rearrangeRanking: vi.fn(),
}));

const summary = (id: string, title: string): ListSummary => ({
  id,
  title,
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 12,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 3,
});

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

const topic = (id: string, name: string, more: Partial<Topic> = {}): Topic => ({
  id,
  name,
  section: "games",
  status: "approved",
  listCount: 0,
  followerCount: 0,
  following: false,
  mergedInto: null,
  ...more,
});

const open = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

beforeEach(() => {
  mocks.loadFeed.mockReset();
  mocks.loadFeed.mockResolvedValue({ lists: [summary("d1", "Something")], nextCursor: null });
  mocks.findTopics.mockReset();
  mocks.findTopics.mockResolvedValue({ topics: [] });
});

describe("SearchPage", () => {
  it("searches the feed for the words in the address, most ranked first", async () => {
    mocks.loadFeed.mockResolvedValue({
      lists: [summary("a1", "Ghibli, ranked"), summary("b2", "Anime openings")],
      nextCursor: "c1",
    });
    open("/search?q=anime");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("“anime”");
    expect(mocks.loadFeed).toHaveBeenCalledWith({ q: "anime", sort: "popular" });
    expect(await screen.findByRole("link", { name: /Ghibli, ranked/ })).toBeInTheDocument();
    expect(screen.getByText("2 lists, and more")).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("searchbox")).toHaveValue("anime");
    // The backend orders a search by title, so there is no order to choose.
    expect(screen.queryByRole("group", { name: "Order" })).toBeNull();
  });

  it("finds topics by name next to the lists, approved ones only, each over its own section", async () => {
    mocks.findTopics.mockResolvedValue({
      topics: [
        topic("t1", "Zelda"),
        topic("t2", "Zeldas, pending", { status: "pending" }),
        topic("t3", "Zelda films", { section: "movies" }),
        topic("t4", "Zelda anything", { section: null }),
      ],
    });
    open("/search?q=zel");
    const tiles = within(await screen.findByRole("navigation", { name: "Topics" }));
    expect(mocks.findTopics).toHaveBeenCalledWith("zel", undefined);
    expect(tiles.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/s/games/t/t1",
      "/s/movies/t/t3",
      "/s/other/t/t4",
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Topics" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Something/ })).toBeInTheDocument();
  });

  it("asks for topics in the section chosen, and waits for them before it shows anything", async () => {
    let answer: (value: { topics: Topic[] }) => void = () => undefined;
    mocks.findTopics.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    open("/search?q=zel&category=games");
    await waitFor(() => expect(mocks.findTopics).toHaveBeenCalledWith("zel", "games"));
    await waitFor(() => expect(mocks.loadFeed).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Something/ })).toBeNull();
    answer({ topics: [topic("t1", "Zelda")] });
    expect(await screen.findByRole("link", { name: /Something/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Topics" })).toBeInTheDocument();
  });

  it("counts topics alone as an answer, and shows them when the lists could not be read", async () => {
    mocks.findTopics.mockResolvedValue({ topics: [topic("t1", "Zelda")] });
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    open("/search?q=zel");
    expect(await screen.findByRole("link", { name: "Zelda" })).toBeInTheDocument();
    expect(screen.queryByText(/No lists match/)).toBeNull();
    expect(screen.queryByText("Nothing published yet")).toBeNull();

    mocks.loadFeed.mockRejectedValue(new Error("down"));
    open("/search?q=zelda");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Zelda" })).not.toHaveLength(0);
  });

  it("searches the lists alone when the topics could not be read", async () => {
    mocks.findTopics.mockRejectedValue(new Error("down"));
    open("/search?q=zel");
    expect(await screen.findByRole("link", { name: /Something/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Topics" })).toBeNull();
  });

  it("changes the order and the category through the chips while browsing", async () => {
    const router = open("/search");
    await userEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(router.state.location.search).toBe("?sort=recent");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ sort: "recent" });

    await userEvent.click(screen.getByRole("button", { name: "Games" }));
    expect(router.state.location.search).toBe("?sort=recent&category=games");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ sort: "recent", category: "games" });

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(router.state.location.search).toBe("?sort=recent");
  });

  it("takes its section chips from the sections, approved ones in their order and Other last", async () => {
    const sections: SectionStats[] = [
      stats("games", { following: true }),
      stats("street-food", { name: "Street food", rank: 1 }),
      stats("night-markets", { name: "Night markets", status: "pending", proposerUid: "g1" }),
      stats("other"),
      stats("anime"),
    ];
    const store = createSectionsStore({
      load: async () => ({ sections }),
      follow: vi.fn(),
      unfollow: vi.fn(),
      now: () => 0,
    });
    const router = createMemoryRouter(
      [{ path: "/search", element: <SearchPage store={store} /> }],
      {
        initialEntries: ["/search?q=zzzz&category=street-food"],
      },
    );
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    render(<RouterProvider router={router} />);
    const chips = within(screen.getByRole("group", { name: "Category" }));
    await waitFor(() =>
      expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
        "All",
        "Games",
        "Street food",
        "Anime",
        "Other",
      ]),
    );
    expect(chips.getByRole("button", { name: "Street food" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.loadFeed).toHaveBeenCalledWith({
      q: "zzzz",
      sort: "popular",
      category: "street-food",
    });
    // Nothing found: the way back is to the section by its name.
    expect(await screen.findByRole("link", { name: "Street food" })).toHaveAttribute(
      "href",
      "/s/street-food",
    );

    await userEvent.click(chips.getByRole("button", { name: "Games" }));
    expect(router.state.location.search).toBe("?q=zzzz&category=games");
  });

  it("keeps the words when a category is chosen", async () => {
    const router = open("/search?q=anime");
    await userEvent.click(screen.getByRole("button", { name: "Games" }));
    expect(router.state.location.search).toBe("?q=anime&category=games");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({
      q: "anime",
      sort: "popular",
      category: "games",
    });
  });

  it("browses when there is nothing to search for, and counts what it found", async () => {
    mocks.loadFeed.mockResolvedValue({ lists: [summary("a1", "One")], nextCursor: null });
    open("/search?category=games&q=a");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Browse lists");
    expect(mocks.loadFeed).toHaveBeenCalledWith({ sort: "popular", category: "games" });
    expect(await screen.findByText("1 list")).toBeInTheDocument();
  });

  it("says when nothing has that name, points at the category and shows what is popular there", async () => {
    mocks.loadFeed.mockImplementation(async (query) =>
      query.q === undefined
        ? {
            lists: [
              summary("p1", "Popular one"),
              summary("p2", "Two"),
              summary("p3", "Three"),
              summary("p4", "Four"),
            ],
            nextCursor: null,
          }
        : { lists: [], nextCursor: null },
    );
    open("/search?q=zzzz&category=anime");
    expect(await screen.findByText(/No lists match/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anime" })).toHaveAttribute("href", "/s/anime");
    expect(screen.getByRole("link", { name: "Make this list" })).toHaveAttribute(
      "href",
      "/b/new?title=zzzz&category=anime",
    );
    // The heading first: it is there only once the second request has been
    // answered. Asked about before that, the request is an effect that may not
    // have run yet, which is how this failed on a slow CI machine.
    expect(await screen.findByRole("heading", { name: "Popular in Anime" })).toBeInTheDocument();
    expect(mocks.loadFeed).toHaveBeenCalledWith({ category: "anime", sort: "popular" });
    expect(
      within(screen.getByRole("list", { name: "Popular in Anime" })).getAllByRole("listitem"),
    ).toHaveLength(3);
    expect(screen.queryByText("Four")).toBeNull();

    open("/search?q=zzzz");
    expect((await screen.findAllByRole("link", { name: "the front page" }))[0]).toHaveAttribute(
      "href",
      "/",
    );
    expect(await screen.findAllByRole("heading", { name: "Popular" })).not.toHaveLength(0);
  });

  it("follows what is typed after a pause", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const router = open("/search?q=anime");
    const box = within(screen.getByRole("main")).getByRole("searchbox");
    await userEvent.clear(box);
    await userEvent.type(box, "ghibli");
    expect(router.state.location.search).toBe("?q=anime");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
    });
    expect(router.state.location.search).toBe("?q=ghibli");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ q: "ghibli", sort: "popular" });
  });

  it("keeps a chip pressed during the pause", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const router = open("/search?q=anime");
    const box = within(screen.getByRole("main")).getByRole("searchbox");
    await userEvent.clear(box);
    await userEvent.type(box, "ghibli");
    await userEvent.click(screen.getByRole("button", { name: "Games" }));
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
    });
    expect(router.state.location.search).toBe("?q=ghibli&category=games");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({
      q: "ghibli",
      sort: "popular",
      category: "games",
    });
  });
});

describe("the search box on the front page", () => {
  it("takes the words the bar's field brings, instead of writing its own back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open("/search?q=anime&sort=recent");
    await screen.findByRole("heading", { level: 1 });
    const bar = within(screen.getByRole("banner"));
    await userEvent.clear(bar.getByRole("searchbox"));
    await userEvent.type(bar.getByRole("searchbox"), "zzz{Enter}");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“zzz”");
    expect(within(screen.getByRole("main")).getByRole("searchbox")).toHaveValue("zzz");
    // Longer than the page's own box waits before it writes what it holds.
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("“zzz”");
  });

  it("leads to the results for what was typed", async () => {
    const router = open("/");
    const box = within(screen.getByRole("main")).getByRole("searchbox");
    expect(box).toBeEnabled();
    await userEvent.type(box, "ghibli{Enter}");
    expect(router.state.location.pathname).toBe("/search");
    expect(router.state.location.search).toBe("?q=ghibli");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“ghibli”");
  });
});
