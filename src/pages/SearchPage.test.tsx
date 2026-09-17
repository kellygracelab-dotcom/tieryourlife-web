import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedPage, FeedQuery, ListSummary } from "../api/types";
import { routes } from "../app/routes";
import { SEARCH_DEBOUNCE_MS } from "./SearchPage";

const mocks = vi.hoisted(() => ({ loadFeed: vi.fn<(query: FeedQuery) => Promise<FeedPage>>() }));
vi.mock("../lib/api", () => ({
  loadFeed: mocks.loadFeed,
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

const open = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

beforeEach(() => {
  mocks.loadFeed.mockReset();
  mocks.loadFeed.mockResolvedValue({ lists: [summary("d1", "Something")], nextCursor: null });
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
    expect(await screen.findByText("Ghibli, ranked")).toBeInTheDocument();
    expect(screen.getByText("2 lists, and more")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("anime");
    expect(screen.getByRole("button", { name: "Most ranked" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("changes the order and the category through the chips, keeping the words", async () => {
    const router = open("/search?q=anime");
    await userEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(router.state.location.search).toBe("?q=anime&sort=recent");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ q: "anime", sort: "recent" });

    await userEvent.click(screen.getByRole("button", { name: "Games" }));
    expect(router.state.location.search).toBe("?q=anime&sort=recent&category=games");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({
      q: "anime",
      sort: "recent",
      category: "games",
    });

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(router.state.location.search).toBe("?q=anime&sort=recent");
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
    expect(await screen.findByText(/Nothing with that name yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anime" })).toHaveAttribute("href", "/c/anime");
    expect(mocks.loadFeed).toHaveBeenCalledWith({ category: "anime", sort: "popular" });
    expect(await screen.findByRole("heading", { name: "Popular in Anime" })).toBeInTheDocument();
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
    const box = screen.getByRole("searchbox");
    await userEvent.clear(box);
    await userEvent.type(box, "ghibli");
    expect(router.state.location.search).toBe("?q=anime");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
    });
    expect(router.state.location.search).toBe("?q=ghibli");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ q: "ghibli", sort: "popular" });
    vi.useRealTimers();
  });
});

describe("the search box on the front page", () => {
  it("leads to the results for what was typed", async () => {
    const router = open("/");
    const box = within(screen.getByRole("search")).getByRole("searchbox");
    expect(box).toBeEnabled();
    await userEvent.type(box, "ghibli{Enter}");
    expect(router.state.location.pathname).toBe("/search");
    expect(router.state.location.search).toBe("?q=ghibli");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“ghibli”");
  });
});
