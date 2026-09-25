import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import { CATEGORIES, type FeedPage, type FeedQuery, type ListSummary } from "../api/types";
import { routes } from "../app/routes";

const mocks = vi.hoisted(() => ({ loadFeed: vi.fn<(query: FeedQuery) => Promise<FeedPage>>() }));
vi.mock("../lib/api", () => ({
  followState: vi.fn(() => new Promise(() => undefined)),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  suggestedAuthors: vi.fn(() => new Promise(() => undefined)),
  loadReports: vi.fn(() => new Promise(() => undefined)),
  report: vi.fn(),
  loadMyLists: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadFeed: mocks.loadFeed,
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
}));

const summary = (id: string, title: string): ListSummary => ({
  id,
  title,
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 34,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 2140,
});

const open = (path = "/") =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

beforeEach(() => {
  mocks.loadFeed.mockReset();
});

describe("HomePage", () => {
  it("leads to the nine categories and shows what is popular", async () => {
    mocks.loadFeed.mockResolvedValue({
      lists: [summary("a1", "Every A24 film, ranked"), summary("b2", "Ghibli, ranked")],
      nextCursor: "c1",
    });
    open();

    const tiles = within(screen.getByRole("navigation", { name: "Categories" })).getAllByRole(
      "link",
    );
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual(
      CATEGORIES.map((id) => `/c/${id}`),
    );
    expect(screen.getByRole("link", { name: "Film & TV" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Popular" })).toBeInTheDocument();
    expect(mocks.loadFeed).toHaveBeenCalledWith({ sort: "popular" });
    expect(await screen.findByRole("link", { name: /Every A24 film, ranked/ })).toBeInTheDocument();
    expect(screen.getAllByText("34 cards · 2,140 rankings")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("opens a category from its tile", async () => {
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    open();
    await userEvent.click(screen.getByRole("link", { name: "Games" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Games");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ category: "games", sort: "popular" });
    expect(await screen.findByText("Nothing published yet")).toBeInTheDocument();
  });

  it("keeps the front page useful when the feed fails", async () => {
    mocks.loadFeed.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the lists.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rank anything");
    expect(screen.getByRole("link", { name: "Anime" })).toBeInTheDocument();
  });
});
