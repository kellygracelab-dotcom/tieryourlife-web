import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import { CATEGORIES, type FeedPage, type FeedQuery, type ListSummary } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext } from "../app/session";
import { forgetFurtherPagesForTests } from "../features/feed/useFeed";

const mocks = vi.hoisted(() => ({
  loadFeed: vi.fn<(query: FeedQuery) => Promise<FeedPage>>(),
  loadFresh: vi.fn<() => Promise<ListSummary[]>>(),
}));
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
  loadFresh: mocks.loadFresh,
  loadList: vi.fn(),
  loadRanking: vi.fn(),
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
  // Show more's pages are kept for this visit: each test starts a visit of its own.
  forgetFurtherPagesForTests();
  mocks.loadFeed.mockReset();
  mocks.loadFresh.mockReset();
  // People's newest lists, unless a test says: on their way for good.
  mocks.loadFresh.mockImplementation(() => new Promise(() => undefined));
});

describe("HomePage", () => {
  it("leads to the sections and shows what is popular this week", async () => {
    mocks.loadFeed.mockResolvedValue({
      lists: [summary("a1", "Every A24 film, ranked"), summary("b2", "Ghibli, ranked")],
      nextCursor: "c1",
    });
    open();

    const tiles = await within(screen.getByRole("navigation", { name: "Sections" })).findAllByRole(
      "link",
    );
    // The nine, in the app's order, until the backend says otherwise.
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual(
      CATEGORIES.map((id) => `/s/${id}`),
    );
    expect(screen.getByRole("link", { name: "Film & TV" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Popular" })).toBeInTheDocument();
    expect(mocks.loadFeed).toHaveBeenCalledWith({ sort: "popular" });
    expect(await screen.findByRole("link", { name: /Every A24 film, ranked/ })).toBeInTheDocument();
    expect(screen.getAllByText("34 cards")).toHaveLength(2);
    expect(screen.queryByText(/2,140/)).toBeNull();
    // More of what is popular is a press away, as the app's Explore reads on.
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(mocks.loadFeed).toHaveBeenLastCalledWith({ sort: "popular", after: "c1" });
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
    // The app card is Explore's: under Following's late lists it would jump.
    expect(screen.queryByRole("complementary", { name: "TierYourLife for Android" })).toBeNull();
  });

  // Danylo's walk, 25.11: "No account needed" under Popular is a guest's line.
  it("tells a guest no account is needed, and not somebody signed in", async () => {
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    const guest = open();
    expect(
      await screen.findByText("Open one and start dragging. No account needed."),
    ).toBeInTheDocument();
    guest.unmount();
    render(
      <SessionContext.Provider
        value={{
          account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null },
          signIn: async () => ({ kind: "cancelled" }),
          signOut: async () => undefined,
          refresh: () => undefined,
        }}
      >
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
      </SessionContext.Provider>,
    );
    expect(await screen.findByText("Open one and start dragging.")).toBeInTheDocument();
    expect(screen.queryByText(/No account needed/)).toBeNull();
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

  it("shows the Android app card under the lists, not above the hero", () => {
    mocks.loadFeed.mockResolvedValue({ lists: [], nextCursor: null });
    open();
    const card = screen.getByRole("complementary", { name: "TierYourLife for Android" });
    const hero = screen.getByRole("heading", { level: 1 });
    const popular = screen.getByRole("region", { name: "Popular" });
    expect(card.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(card.compareDocumentPosition(popular) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // The page's outline still starts at its h1: the card's title is no heading.
    expect(screen.getAllByRole("heading")[0]).toBe(hero);
  });

  // Marketing, 23.11: no row of its own; up to four first in Popular, with
  // "New", and never again further down, on any page.
  it("puts people's newest lists first in Popular with New, each once on every page", async () => {
    const fresh = ["f1", "f2", "a1", "f4", "f5"].map((id) => ({
      ...summary(id, `Fresh ${id}`),
      authorName: "olena",
    }));
    mocks.loadFresh.mockResolvedValue(fresh);
    mocks.loadFeed.mockImplementation(async (query) =>
      query.after === undefined
        ? { lists: [summary("a1", "Every A24 film"), summary("b2", "Ghibli")], nextCursor: "b2" }
        : { lists: [summary("f4", "Fresh again"), summary("c3", "Pixar")], nextCursor: null },
    );
    open();
    const popular = await screen.findByRole("list", { name: "Popular" });
    await within(popular).findByText("Fresh f1");
    // This visit's page from the tests before goes once the fresh one is in.
    const showMore = await screen.findByRole("button", { name: "Show more" });
    const titles = () =>
      within(popular)
        .getAllByRole("article")
        .map((card) => card.querySelector(".list-card__title")?.textContent);
    expect(titles()).toEqual(["Fresh f1", "Fresh f2", "Fresh a1", "Fresh f4", "Ghibli"]);
    expect(within(popular).getAllByText("New")).toHaveLength(4);
    expect(screen.queryByRole("heading", { name: "New from the community" })).toBeNull();

    await userEvent.click(showMore);
    await within(popular).findByText("Pixar");
    // The next page from Popular's own cursor, the one already on top left out.
    expect(mocks.loadFeed).toHaveBeenLastCalledWith(expect.objectContaining({ after: "b2" }));
    expect(titles()).toEqual(["Fresh f1", "Fresh f2", "Fresh a1", "Fresh f4", "Ghibli", "Pixar"]);
  });

  it("shows Popular as it is when the newest lists cannot be had", async () => {
    mocks.loadFresh.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    mocks.loadFeed.mockResolvedValue({
      lists: [summary("s1", "Spirited Away"), summary("s2", "Perfect Blue")],
      nextCursor: null,
    });
    open();
    const popular = await screen.findByRole("list", { name: "Popular" });
    await within(popular).findByText("Perfect Blue");
    expect(within(popular).getAllByRole("article")).toHaveLength(2);
    expect(within(popular).queryByText("New")).toBeNull();
  });
});
