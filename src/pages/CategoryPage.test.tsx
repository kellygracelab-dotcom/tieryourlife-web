import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedPage, FeedQuery, ListSummary } from "../api/types";
import { routes } from "../app/routes";

const mocks = vi.hoisted(() => ({ loadFeed: vi.fn<(query: FeedQuery) => Promise<FeedPage>>() }));
vi.mock("../lib/api", () => ({
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
  category: "games",
  itemCount: 5,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

const open = (path: string) =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

beforeEach(() => {
  mocks.loadFeed.mockReset();
});

describe("CategoryPage", () => {
  it("lists a category most-ranked first and pages on request", async () => {
    mocks.loadFeed
      .mockResolvedValueOnce({ lists: [summary("a1", "Zelda, ranked")], nextCursor: "c1" })
      .mockResolvedValueOnce({ lists: [summary("b2", "Mario, ranked")], nextCursor: null });
    open("/c/games");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Games");
    expect(mocks.loadFeed).toHaveBeenCalledWith({ category: "games", sort: "popular" });
    expect(await screen.findByText("Zelda, ranked")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({
      category: "games",
      sort: "popular",
      after: "c1",
    });
    expect(await screen.findByText("Mario, ranked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("treats an unknown category as a missing page", () => {
    open("/c/nope");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "There is nothing at this address.",
    );
    expect(mocks.loadFeed).not.toHaveBeenCalled();
  });
});
