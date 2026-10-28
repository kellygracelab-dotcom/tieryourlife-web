import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionStats, Topic } from "../api/sections";
import type { FeedPage, FeedQuery } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { createSectionsStore, type SectionsDeps } from "../features/sections/useSections";
import { memoryStore } from "../lib/storage";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { SectionPage, type TopicDeps } from "./SectionPage";
import { SectionsPage } from "./SectionsPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 812,
  followerCount: 3410,
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
  listCount: 64,
  followerCount: 210,
  following: false,
  createdBy: "u9",
  mergedInto: null,
  ...more,
});

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "D",
  photoUrl: null,
};

const load = vi.fn<(query: FeedQuery) => Promise<FeedPage>>();
const sectionsDeps = {
  load: vi.fn<SectionsDeps["load"]>(),
  follow: vi.fn<SectionsDeps["follow"]>(),
  unfollow: vi.fn<SectionsDeps["unfollow"]>(),
};
const topics: TopicDeps = {
  load: vi.fn(async () => ({
    topics: [topic("t1", "Indies", { followerCount: 3 }), topic("t2", "Pokémon")],
  })),
  mine: vi.fn(async () => ({
    topics: [topic("t3", "Speedruns", { status: "pending", createdBy: "u1" })],
  })),
  follow: vi.fn(async () => ({ following: true })),
  unfollow: vi.fn(async () => ({ following: false })),
};

function open(path: string, account: Session["account"] = member) {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const router = createMemoryRouter(
    [
      { path: "/s", element: <SectionsPage store={store} /> },
      { path: "/s/:id", element: <SectionPage load={load} store={store} topics={topics} /> },
      {
        path: "/s/:id/t/:topic",
        element: <SectionPage load={load} store={store} topics={topics} />,
      },
      { path: "/", element: <h1>Home</h1> },
    ],
    { initialEntries: [path] },
  );
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
  return router;
}

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue({ lists: [], nextCursor: null });
  sectionsDeps.load.mockReset();
  sectionsDeps.load.mockResolvedValue({
    sections: [
      stats("games"),
      stats("anime", { listCount: 3 }),
      stats("other", { listCount: 900 }),
    ],
  });
  sectionsDeps.follow.mockReset();
  sectionsDeps.follow.mockResolvedValue({ following: true });
  sectionsDeps.unfollow.mockReset();
  sectionsDeps.unfollow.mockResolvedValue({ following: false });
  useHiddenStoreForTests(memoryStore());
});

describe("SectionPage", () => {
  it("heads the section with its counts and Follow, its topics as chips, and its lists by popularity", async () => {
    open("/s/games");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Games");
    expect(await screen.findByText("3,410 followers · 812 lists")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ category: "games", sort: "popular" });

    const chips = within(screen.getByRole("navigation", { name: "Topics" }));
    // All, then by followers, then this person's waiting ones, then the way to suggest one.
    expect(await chips.findByRole("link", { name: "Pokémon" })).toBeInTheDocument();
    expect(chips.getAllByRole("link").map((chip) => chip.textContent)).toEqual([
      "All",
      "Pokémon",
      "Indies",
      "Speedruns · waiting",
      "addSuggest a topic",
    ]);
    expect(chips.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  });

  it("follows at once, and unfollows with a way back", async () => {
    open("/s/games");
    await screen.findByText("3,410 followers · 812 lists");
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(sectionsDeps.follow).toHaveBeenCalledWith("games");
    expect(screen.getByText("3,411 followers · 812 lists")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Following/ }));
    expect(sectionsDeps.unfollow).toHaveBeenCalledWith("games");
    expect(screen.getByRole("status")).toHaveTextContent("Unfollowed Games");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sectionsDeps.follow).toHaveBeenCalledTimes(2);
  });

  it("asks a guest to sign in before following", async () => {
    open("/s/games", { kind: "guest", uid: null });
    await screen.findByText("3,410 followers · 812 lists");
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(screen.getByRole("heading", { name: "Sign in to follow" })).toBeInTheDocument();
    expect(sectionsDeps.follow).not.toHaveBeenCalled();
  });

  it("narrows to one topic, with its own counts and Follow", async () => {
    open("/s/games/t/t2");
    expect(await screen.findByText("210 followers · 64 lists")).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith({ category: "games", topic: "t2", sort: "popular" });
    const buttons = screen.getAllByRole("button", { name: "Follow" });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(topics.follow).toHaveBeenCalledWith("t2");
  });

  it("orders by newest on request, in the address", async () => {
    const router = open("/s/games");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Order" }), "recent");
    expect(router.state.location.search).toBe("?sort=recent");
    expect(load).toHaveBeenLastCalledWith({ category: "games", sort: "recent" });
  });

  it("says there is no such section once the backend has answered", async () => {
    open("/s/nowhere");
    expect(await screen.findByText("There is nothing at this address.")).toBeInTheDocument();
  });
});

describe("SectionsPage", () => {
  it("lists every section by how many lists each has, Other last, or by name", async () => {
    open("/s");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All sections");
    const grid = within(screen.getByRole("navigation", { name: "All sections" }));
    await screen.findByText("3 sections");
    expect(grid.getAllByRole("link").map((tile) => tile.getAttribute("href"))).toEqual([
      "/s/games",
      "/s/anime",
      "/s/other",
    ]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Order" }), "name");
    expect(grid.getAllByRole("link").map((tile) => tile.getAttribute("href"))).toEqual([
      "/s/anime",
      "/s/games",
      "/s/other",
    ]);
  });
});
