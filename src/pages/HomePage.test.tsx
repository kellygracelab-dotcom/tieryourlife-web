import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import { CATEGORIES, type FeedPage, type FeedQuery, type ListSummary } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext } from "../app/session";

const mocks = vi.hoisted(() => ({ loadFeed: vi.fn<(query: FeedQuery) => Promise<FeedPage>>() }));
vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  // The sections answer at once: until they do, a page draws their places only.
  loadSections: vi.fn(async () => ({
    sections: (await import("../api/types")).CATEGORIES.map((id) => ({
      id,
      listCount: 0,
      followerCount: 0,
      newThisWeek: 0,
      collage: [],
      following: false,
    })),
  })),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  report: vi.fn(),
  loadMyLists: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadFeed: mocks.loadFeed,
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  // A section's page waits for its topics before it shows its lists.
  loadTopics: vi.fn(async () => ({ topics: [] })),
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
  it("leads to the sections and shows what is popular this week", async () => {
    mocks.loadFeed.mockResolvedValue({
      lists: [summary("a1", "Every A24 film, ranked"), summary("b2", "Ghibli, ranked")],
      nextCursor: "c1",
    });
    open();

    const tiles = await within(
      screen.getByRole("navigation", { name: "Categories" }),
    ).findAllByRole("link");
    // The nine, in the app's order, until the backend says otherwise.
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual(
      CATEGORIES.map((id) => `/s/${id}`),
    );
    expect(screen.getByRole("link", { name: "Film & TV" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Popular this week" })).toBeInTheDocument();
    expect(mocks.loadFeed).toHaveBeenCalledWith({ sort: "popular" });
    expect(await screen.findByRole("link", { name: /Every A24 film, ranked/ })).toBeInTheDocument();
    expect(screen.getAllByText("34 cards")).toHaveLength(2);
    expect(screen.queryByText(/2,140/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("draws Explore and Following from the start on a device last seen signed in", () => {
    window.localStorage.setItem("tyl:signedIn", "1");
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    // Firebase has not said who is here yet.
    render(
      <SessionContext.Provider
        value={{
          account: null,
          signIn: async () => ({ kind: "cancelled" }),
          signOut: async () => undefined,
          refresh: () => undefined,
        }}
      >
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/following"] })} />
      </SessionContext.Provider>,
    );
    expect(screen.getByRole("link", { name: "Following" })).toHaveAttribute("aria-current", "page");
    // Whose Following it is, Firebase has not said yet: a ring, not Explore.
    expect(screen.getByRole("progressbar", { name: "Following" })).toBeInTheDocument();
  });

  it("opens a section from its tile", async () => {
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    open();
    await userEvent.click(await screen.findByRole("link", { name: "Games" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Games");
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ category: "games", sort: "popular" });
    expect(await screen.findByText("Nothing published yet")).toBeInTheDocument();
  });

  it("leads a section's old address to its new one", async () => {
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    open("/c/books");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Books");
  });

  it("keeps the front page useful when the feed fails", async () => {
    mocks.loadFeed.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the lists.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rank anything");
    expect(await screen.findByRole("link", { name: "Anime" })).toBeInTheDocument();
  });

  it("shows the Android app card first, above the hero", () => {
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    open();
    const card = screen.getByRole("complementary", { name: "TierYourLife for Android" });
    const hero = screen.getByRole("heading", { level: 1 });
    expect(card.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
