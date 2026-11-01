import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { SectionStats, Topic } from "../api/sections";
import type { FeedPage, FeedQuery } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { createSectionsStore, type SectionsDeps } from "../features/sections/useSections";
import type { SignInOutcome } from "../lib/signIn";
import { memoryStore } from "../lib/storage";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { SectionPage } from "./SectionPage";
import { SectionsPage } from "./SectionsPage";
import type { TopicDeps } from "./SectionPageState";
import { TopicPage } from "./TopicPage";

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
const topics = {
  load: vi.fn<TopicDeps["load"]>(),
  mine: vi.fn<TopicDeps["mine"]>(),
  one: vi.fn<TopicDeps["one"]>(),
  follow: vi.fn<TopicDeps["follow"]>(),
  unfollow: vi.fn<TopicDeps["unfollow"]>(),
};

const loadOne = vi.fn<(id: string) => Promise<SectionStats>>();
const signIn = vi.fn<() => Promise<SignInOutcome>>();

function open(path: string, account: Session["account"] = member) {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const deps = { load, store, topics, loadOne };
  const router = createMemoryRouter(
    [
      { path: "/s", element: <SectionsPage store={store} /> },
      { path: "/s/:id", element: <SectionPage {...deps} /> },
      { path: "/s/:id/t/:topic", element: <TopicPage {...deps} /> },
      { path: "/", element: <h1>Home</h1> },
    ],
    { initialEntries: [path] },
  );
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn,
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
  topics.load.mockReset();
  topics.load.mockResolvedValue({
    topics: [topic("t1", "Indies", { followerCount: 3 }), topic("t2", "Pokémon")],
  });
  topics.mine.mockReset();
  topics.mine.mockResolvedValue({
    topics: [topic("t3", "Speedruns", { status: "pending", createdBy: "u1" })],
  });
  topics.one.mockReset();
  topics.one.mockRejectedValue(new ApiFailure({ kind: "notFound" }));
  topics.follow.mockReset();
  topics.follow.mockResolvedValue({ following: true });
  topics.unfollow.mockReset();
  topics.unfollow.mockResolvedValue({ following: false });
  loadOne.mockReset();
  loadOne.mockRejectedValue(new ApiFailure({ kind: "notFound" }));
  signIn.mockReset();
  signIn.mockResolvedValue({ kind: "cancelled" });
  useHiddenStoreForTests(memoryStore());
});

/** The section's topics as tiles, once they have answered. */
const tiles = async () => {
  const grid = within(await screen.findByRole("navigation", { name: "Topics" }));
  await grid.findByRole("link", { name: "Pokémon" });
  return grid;
};

describe("SectionPage", () => {
  it("heads the section with Follow and no counts, its topics as tiles, and all its lists", async () => {
    open("/s/games");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Games");
    await waitFor(() => expect(sectionsDeps.load).toHaveBeenCalled());
    // The lists are the section's own, whatever topic they carry.
    expect(load).toHaveBeenCalledWith({ category: "games", sort: "popular" });

    const grid = await tiles();
    expect(screen.getByRole("heading", { level: 2, name: "Topics" })).toBeInTheDocument();
    const all = screen.getByRole("navigation", { name: "Topics" }).querySelectorAll("a, button");
    // By followers, then this person's waiting ones.
    expect([...all].map((tile) => tile.getAttribute("href"))).toEqual([
      "/s/games/t/t2",
      "/s/games/t/t1",
      null,
    ]);
    expect(grid.getByRole("button", { name: "Speedruns · waiting" })).toHaveTextContent(
      /Waiting\s*Speedruns/,
    );
    expect(screen.getByRole("link", { name: /Suggest a topic/ })).toHaveAttribute(
      "href",
      "/b/new?category=games",
    );
    // A small count makes the place look empty, a big one is noise: neither is said.
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(screen.queryByText(/followers?|3,410|812/)).toBeNull();
    // The chips and their All are gone with the filtering they did.
    expect(screen.queryByRole("link", { name: "All" })).toBeNull();
  });

  it("follows at once, and unfollows with a way back", async () => {
    open("/s/games");
    await tiles();
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

  it("says so when a follow does not go through", async () => {
    sectionsDeps.follow.mockRejectedValue(new ApiFailure({ kind: "offline" }));
    open("/s/games");
    await tiles();
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't follow. Try again.");
  });

  it("asks a guest to sign in before following", async () => {
    open("/s/games", { kind: "guest", uid: null });
    await tiles();
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(screen.getByRole("heading", { name: "Sign in to follow" })).toBeInTheDocument();
    expect(sectionsDeps.follow).not.toHaveBeenCalled();
    // A guest has no waiting topics to be asked about.
    expect(topics.mine).not.toHaveBeenCalled();
  });

  it("opens a topic's own page from its tile", async () => {
    const router = open("/s/games");
    const grid = await tiles();
    await userEvent.click(grid.getByRole("link", { name: "Pokémon" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Pokémon");
    expect(router.state.location.pathname).toBe("/s/games/t/t2");
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({ category: "games", topic: "t2", sort: "popular" }),
    );
  });

  it("opens what is known of a waiting topic in place, without a way to take it back", async () => {
    const router = open("/s/games");
    const grid = await tiles();
    await userEvent.click(grid.getByRole("button", { name: "Speedruns · waiting" }));
    const sheet = screen.getByRole("dialog", { name: "Speedruns" });
    expect(sheet).toHaveTextContent("until then they're in Games");
    expect(sheet).toHaveTextContent("Only you see this topic until then.");
    expect(within(sheet).queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(router.state.location.pathname).toBe("/s/games");
    await userEvent.click(within(sheet).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws a topic's own picture on its tile, and its section's art without one", async () => {
    topics.load.mockResolvedValue({
      topics: [
        topic("t1", "Indies", { pictureUrl: "https://pictures.test/indies.webp" }),
        topic("t2", "Pokémon", { pictureUrl: "http://plain.test/p.webp" }),
      ],
    });
    open("/s/games");
    const grid = await tiles();
    const indies = grid.getByRole("link", { name: "Indies" });
    expect(indies.querySelector("img")).toHaveAttribute("src", "https://pictures.test/indies.webp");
    const plain = grid.getByRole("link", { name: "Pokémon" });
    expect(plain.querySelector("img")).toBeNull();
    expect(plain).toHaveStyle({ "--tint-light": "#3D6B58" });
  });

  it("has no Topics title without topics, and still the way to suggest one", async () => {
    topics.load.mockResolvedValue({ topics: [] });
    topics.mine.mockResolvedValue({ topics: [] });
    open("/s/games");
    await waitFor(() => expect(topics.mine).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /Suggest a topic/ })).toHaveAttribute(
      "href",
      "/b/new?category=games",
    );
    expect(screen.queryByRole("heading", { level: 2, name: "Topics" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Topics" })).toBeNull();
  });

  it("orders by newest on request, in the address", async () => {
    const router = open("/s/games");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Order" }), "recent");
    expect(router.state.location.search).toBe("?sort=recent");
    expect(load).toHaveBeenLastCalledWith({ category: "games", sort: "recent" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Order" }), "popular");
    expect(router.state.location.search).toBe("");
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
    expect(await screen.findByRole("heading", { level: 1, name: "Pokémon" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/s/games/t/t2");
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({ category: "games", topic: "t2", sort: "popular" }),
    );
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

describe("TopicPage", () => {
  it("heads a topic with its section's name, its Follow and no counts, and lists only its lists", async () => {
    open("/s/games/t/t2");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Pokémon");
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("Games");
    expect(within(header).getByRole("link", { name: "Navigate back" })).toHaveAttribute(
      "href",
      "/s/games",
    );
    expect(load).toHaveBeenCalledWith({ category: "games", topic: "t2", sort: "popular" });
    expect(screen.queryByText(/followers?|210|64 lists/)).toBeNull();
    // A topic's page has no tiles of its own, and no Follow for the section.
    expect(screen.queryByRole("navigation", { name: "Topics" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Follow" })).toHaveLength(1);
  });

  it("follows the topic at once, and unfollows it with a way back", async () => {
    open("/s/games/t/t2");
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(topics.follow).toHaveBeenCalledWith("t2");
    expect(sectionsDeps.follow).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Following/ }));
    expect(topics.unfollow).toHaveBeenCalledWith("t2");
    expect(screen.getByRole("status")).toHaveTextContent("Unfollowed Pokémon");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(topics.follow).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /Following/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("takes a follow back when the backend refuses it", async () => {
    topics.follow.mockRejectedValue(new ApiFailure({ kind: "offline" }));
    open("/s/games/t/t2");
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't follow. Try again.");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks a guest to sign in, and follows once they have", async () => {
    signIn.mockResolvedValue({ kind: "signedIn", switched: false });
    open("/s/games/t/t2", { kind: "guest", uid: null });
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    const ask = screen.getByRole("dialog", { name: "Sign in to follow" });
    expect(topics.follow).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(topics.follow).toHaveBeenCalledWith("t2"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("follows nothing when the guest does not sign in after all", async () => {
    open("/s/games/t/t2", { kind: "guest", uid: null });
    await userEvent.click(await screen.findByRole("button", { name: "Follow" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(topics.follow).not.toHaveBeenCalled();
  });

  it("says a waiting topic waits, with no Follow, which only an approved one takes", async () => {
    open("/s/games/t/t3");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Speedruns");
    expect(screen.getByRole("banner")).toHaveTextContent("Waiting");
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(load).toHaveBeenCalledWith({ category: "games", topic: "t3", sort: "popular" });
  });

  it("draws the topic's own picture in its header, and its section's art without one", async () => {
    // The section's covers are its lists', not the topic's: its page never borrows them.
    sectionsDeps.load.mockResolvedValue({
      sections: [
        stats("games", { collage: ["a", "b", "c", "d"].map((n) => `https://c.test/${n}`) }),
      ],
    });
    topics.load.mockResolvedValue({
      topics: [
        topic("t1", "Indies", { pictureUrl: "https://pictures.test/indies.webp" }),
        topic("t2", "Pokémon"),
      ],
    });
    const router = open("/s/games/t/t1");
    await screen.findByRole("heading", { level: 1, name: "Indies" });
    expect(screen.getByRole("banner").querySelector("img")).toHaveAttribute(
      "src",
      "https://pictures.test/indies.webp",
    );
    await router.navigate("/s/games/t/t2");
    await screen.findByRole("heading", { level: 1, name: "Pokémon" });
    expect(screen.getByRole("banner").querySelector("img")).toBeNull();
  });

  it("says there is no such topic, with the way back to the section", async () => {
    open("/s/games/t/nope");
    expect(await screen.findByText("There’s no such topic in Games.")).toBeInTheDocument();
    expect(topics.one).toHaveBeenCalledExactlyOnceWith("nope");
    expect(screen.getByRole("link", { name: "Back to Games" })).toHaveAttribute("href", "/s/games");
  });

  it("asks by its id for a topic beyond the section's biggest", async () => {
    topics.one.mockResolvedValue(topic("t9", "Roguelikes", { following: true }));
    open("/s/games/t/t9");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Roguelikes");
    expect(screen.getByRole("button", { name: /Following/ })).toBeInTheDocument();
  });

  it("goes on to the section a topic is filed under, and to the topic one was merged into", async () => {
    topics.one.mockImplementation(async (id) =>
      id === "t8"
        ? topic("t8", "Old name", { status: "merged", mergedInto: "t2" })
        : topic("t9", "Mecha", { section: "anime" }),
    );
    const router = open("/s/games/t/t9");
    await waitFor(() => expect(router.state.location.pathname).toBe("/s/anime/t/t9"));
    await router.navigate("/s/games/t/t8");
    expect(await screen.findByRole("heading", { level: 1, name: "Pokémon" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/s/games/t/t2");
  });

  it("is not there for a topic declined or still waiting for somebody else", async () => {
    topics.one.mockResolvedValue(topic("t7", "Nope", { status: "rejected" }));
    open("/s/games/t/t7");
    expect(await screen.findByText("There’s no such topic in Games.")).toBeInTheDocument();
  });

  it("offers another try when the topic could not be asked about", async () => {
    topics.one.mockRejectedValueOnce(new ApiFailure({ kind: "offline" }));
    topics.one.mockResolvedValueOnce(topic("t9", "Roguelikes"));
    open("/s/games/t/t9");
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Roguelikes");
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
