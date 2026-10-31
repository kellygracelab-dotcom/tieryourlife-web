import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
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

const loadOne = vi.fn<(id: string) => Promise<SectionStats>>();

function open(path: string, account: Session["account"] = member) {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const page = <SectionPage load={load} store={store} topics={topics} loadOne={loadOne} />;
  const router = createMemoryRouter(
    [
      { path: "/s", element: <SectionsPage store={store} /> },
      { path: "/s/:id", element: page },
      { path: "/s/:id/t/:topic", element: page },
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
  loadOne.mockReset();
  loadOne.mockRejectedValue(new ApiFailure({ kind: "notFound" }));
  useHiddenStoreForTests(memoryStore());
});

/** The section and its topics have answered: the chips stand once they have. */
const sectionRead = async () => {
  await waitFor(() => expect(sectionsDeps.load).toHaveBeenCalled());
  await within(screen.getByRole("navigation", { name: "Topics" })).findByRole("link", {
    name: "Pokémon",
  });
};

describe("SectionPage", () => {
  it("heads the section with Follow and no counts, its topics as chips, and its lists by popularity", async () => {
    open("/s/games");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Games");
    await waitFor(() => expect(sectionsDeps.load).toHaveBeenCalled());
    expect(load).toHaveBeenCalledWith({ category: "games", sort: "popular" });

    const chips = within(screen.getByRole("navigation", { name: "Topics" }));
    // All, then by followers, then this person's waiting ones, then the way to suggest one.
    expect(await chips.findByRole("link", { name: "Pokémon" })).toBeInTheDocument();
    // A small count makes the place look empty, a big one is noise: neither is said.
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(screen.queryByText(/followers?|3,410|812/)).toBeNull();
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
    await sectionRead();
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(sectionsDeps.follow).toHaveBeenCalledWith("games");
    expect(screen.getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText(/followers?|3,411/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Following/ }));
    expect(sectionsDeps.unfollow).toHaveBeenCalledWith("games");
    expect(screen.getByRole("status")).toHaveTextContent("Unfollowed Games");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sectionsDeps.follow).toHaveBeenCalledTimes(2);
  });

  it("asks a guest to sign in before following", async () => {
    open("/s/games", { kind: "guest", uid: null });
    await sectionRead();
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(screen.getByRole("heading", { name: "Sign in to follow" })).toBeInTheDocument();
    expect(sectionsDeps.follow).not.toHaveBeenCalled();
  });

  it("narrows to one topic, with its own name and Follow and no counts", async () => {
    open("/s/games/t/t2");
    expect(await screen.findByRole("heading", { level: 2, name: "Pokémon" })).toBeInTheDocument();
    expect(screen.queryByText(/followers?|210|64 lists/)).toBeNull();
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
    expect(loadOne).toHaveBeenCalledExactlyOnceWith("nowhere");
  });

  it("lists a section of somebody's own by its id, as it lists one of the nine", async () => {
    sectionsDeps.load.mockResolvedValue({
      sections: [stats("street-food", { name: "Street food" }), stats("other")],
    });
    open("/s/street-food");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Street food");
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith({ category: "street-food", sort: "popular" }),
    );
    expect(loadOne).not.toHaveBeenCalled();
  });

  it("asks once for a section the sections do not hold, and lists only its lists", async () => {
    loadOne.mockResolvedValue(stats("s-k3j9x2ab", { name: "Ramen", hidden: true, listCount: 4 }));
    open("/s/s-k3j9x2ab");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Ramen");
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith({ category: "s-k3j9x2ab", sort: "popular" }),
    );
    expect(loadOne).toHaveBeenCalledExactlyOnceWith("s-k3j9x2ab");
    // Never the whole feed under the section's name.
    expect(load).not.toHaveBeenCalledWith({ sort: "popular" });
  });

  it("goes on to the section one was merged into", async () => {
    loadOne.mockRejectedValue(new ApiFailure({ kind: "merged", into: "games", topic: null }));
    const router = open("/s/videogames");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Games");
    expect(router.state.location.pathname).toBe("/s/games");
    await waitFor(() => expect(load).toHaveBeenCalledWith({ category: "games", sort: "popular" }));
  });

  it("goes on to the topic a proposal became, inside the section it went into", async () => {
    loadOne.mockRejectedValue(new ApiFailure({ kind: "merged", into: "games", topic: "t2" }));
    const router = open("/s/s-pokemon");
    expect(await screen.findByRole("heading", { level: 2, name: "Pokémon" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/s/games/t/t2");
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({ category: "games", topic: "t2", sort: "popular" }),
    );
  });

  it("draws a topic's own picture in its header, and its section's icon without one", async () => {
    vi.mocked(topics.load).mockResolvedValueOnce({
      topics: [
        topic("t1", "Indies", { pictureUrl: "https://pictures.test/indies.webp" }),
        topic("t2", "Pokémon", { pictureUrl: "http://plain.test/p.webp" }),
      ],
    });
    open("/s/games/t/t1");
    const header = (await screen.findByRole("heading", { level: 2, name: "Indies" })).closest(
      ".section-topic",
    )!;
    expect(header.querySelector("img")).toHaveAttribute("src", "https://pictures.test/indies.webp");
    await userEvent.click(screen.getByRole("link", { name: "Pokémon" }));
    const plain = (await screen.findByRole("heading", { level: 2, name: "Pokémon" })).closest(
      ".section-topic",
    )!;
    expect(plain.querySelector("img")).toBeNull();
    expect(plain.querySelector(".ms")).not.toBeNull();
  });

  it("offers another try when the section could not be asked about", async () => {
    loadOne.mockRejectedValueOnce(new ApiFailure({ kind: "offline" }));
    loadOne.mockResolvedValueOnce(stats("s-k3j9x2ab", { name: "Ramen" }));
    open("/s/s-k3j9x2ab");
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Ramen");
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
