import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { remembered } from "../../lib/remembered";
import { memoryStore } from "../../lib/storage";
import type { SectionStats } from "../../api/sections";
import { sectionsFrom } from "./model";
import { SectionGrid } from "./SectionGrid";
import {
  createSectionsStore,
  readKeptSections,
  SECTIONS_FRESH_MS,
  type SectionsDeps,
} from "./useSections";

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

function deps(answer: SectionStats[], more: Partial<SectionsDeps> = {}) {
  let now = 1_000;
  const all: SectionsDeps = {
    load: vi.fn(async () => ({ sections: answer })),
    follow: vi.fn(async () => ({ following: true })),
    unfollow: vi.fn(async () => ({ following: false })),
    now: () => now,
    ...more,
  };
  return { deps: all, later: (ms: number) => (now += ms) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the sections store", () => {
  it("asks once for the same person while the answer is fresh, and again for somebody else", async () => {
    const { deps: given, later } = deps([stats("anime"), stats("other")]);
    const store = createSectionsStore(given);
    expect(store.get().loaded).toBe(false);
    expect(store.get().sections).toHaveLength(9);

    store.refresh("guest");
    await settle();
    expect(store.get()).toMatchObject({ loaded: true, failed: false });
    expect(store.get().sections.map((section) => section.id)).toEqual(["anime", "other"]);

    store.refresh("guest");
    expect(given.load).toHaveBeenCalledTimes(1);
    store.refresh("u1");
    await settle();
    expect(given.load).toHaveBeenCalledTimes(2);
    later(SECTIONS_FRESH_MS + 1);
    store.refresh("u1");
    await settle();
    expect(given.load).toHaveBeenCalledTimes(3);
  });

  it("asks again for whoever signed in while the first answer was on its way", async () => {
    const { deps: given } = deps([stats("anime")]);
    const store = createSectionsStore(given);
    store.refresh("guest");
    store.refresh("u1");
    await settle();
    await settle();
    expect(given.load).toHaveBeenCalledTimes(2);
  });

  it("opens with the answer last read on this device, and keeps the new one", async () => {
    const memory = remembered(memoryStore(), "s", 1, readKeptSections);
    const before = createSectionsStore(
      deps([stats("games", { rank: 1 }), stats("other")], { memory }).deps,
    );
    // Nothing read yet: the nine only stand in to be counted.
    expect(before.get()).toMatchObject({ known: false, loaded: false });
    before.refresh("guest");
    await settle();
    expect(before.get().known).toBe(true);

    const after = createSectionsStore(deps([stats("anime")], { memory }).deps);
    expect(after.get()).toMatchObject({ known: true, loaded: false });
    expect(after.get().sections.map((section) => section.id)).toEqual(["games", "other"]);
  });

  it("never shows the next person on a shared browser what the last one followed or proposed", async () => {
    const memory = remembered(memoryStore(), "s", 1, readKeptSections);
    const mine = [
      stats("anime"),
      stats("people", { following: true }),
      stats("club", { status: "pending", proposerUid: "a" }),
    ];
    const before = createSectionsStore(deps(mine, { memory }).deps);
    before.refresh("a");
    await settle();

    // The answer for the guest is slow; meanwhile the kept one is drawn for them.
    const after = createSectionsStore(
      deps([], { memory, load: vi.fn(() => new Promise<never>(() => undefined)) }).deps,
    );
    expect(after.get().sections.map((section) => section.id)).toContain("club");
    after.refresh("guest");
    expect(after.get().sections.map((section) => section.id)).toEqual(["anime", "people"]);
    expect(after.get().sections.some((section) => section.following)).toBe(false);
    expect(after.get().followsKnown).toBe(false);
  });

  it("drops a kept answer it cannot draw, and asks the backend as if nothing was kept", async () => {
    const store = memoryStore();
    const memory = remembered(store, "s", 1, readKeptSections);
    for (const bad of [{ sections: [{}] }, {}, [], { sections: [{ id: "x" }] }, "x"]) {
      store.write("s:sections", JSON.stringify(bad));
      const given = deps([stats("anime")], { memory }).deps;
      const sections = createSectionsStore(given);
      expect(sections.get()).toMatchObject({ known: false });
      sections.refresh("guest");
      await settle();
      expect(sections.get()).toMatchObject({ loaded: true, failed: false });
    }
  });

  it("draws an answer whose section has no collage, and keeps nothing it cannot draw", async () => {
    const memory = remembered(memoryStore(), "s", 1, readKeptSections);
    const odd = { ...stats("anime"), collage: undefined } as unknown as SectionStats;
    const sections = createSectionsStore(deps([odd], { memory }).deps);
    sections.refresh("guest");
    await settle();
    expect(sections.get().sections.map((section) => section.collage)).toEqual([[]]);
  });

  it("keeps the nine and says so when the backend fails", async () => {
    const { deps: given } = deps([], {
      load: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    const store = createSectionsStore(given);
    store.refresh("guest");
    await settle();
    expect(store.get()).toMatchObject({ loaded: false, failed: true });
    expect(store.get().sections).toHaveLength(9);
  });

  it("moves a followed section to the front at once, and back when the backend says no", async () => {
    const refuse = vi.fn(async () => Promise.reject(new Error("no")));
    const { deps: given } = deps(
      [stats("anime"), stats("games", { followerCount: 4 }), stats("other")],
      {
        follow: refuse,
      },
    );
    const store = createSectionsStore(given);
    store.refresh("u1");
    await settle();
    const pending = store.setFollowing("games", true);
    expect(store.get().sections[0]).toMatchObject({
      id: "games",
      following: true,
      followerCount: 5,
    });
    await expect(pending).resolves.toEqual({ kind: "unknown", status: 0 });
    expect(store.get().sections.map((section) => section.id)).toEqual(["anime", "games", "other"]);
    expect(store.get().sections[1]).toMatchObject({ following: false, followerCount: 4 });
    expect(refuse).toHaveBeenCalledWith("games");
  });

  it("keeps a follow made while the sections were asked for, over an answer read before it", async () => {
    let answer!: (value: { sections: SectionStats[] }) => void;
    const load = vi
      .fn<SectionsDeps["load"]>()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const memory = remembered(memoryStore(), "s", 1, readKeptSections);
    const store = createSectionsStore(deps([], { load, memory }).deps);
    store.refresh("u1");
    await store.setFollowing("anime", true);
    answer({ sections: [stats("anime"), stats("other")] });
    await settle();
    expect(store.get().sections.find((one) => one.id === "anime")?.following).toBe(true);
    // And it is what the device opens with next time.
    expect(memory.recall("sections")?.sections[0]).toMatchObject({ id: "anime", following: true });
  });

  it("keeps a follow on the device, and takes in one another tab kept there", async () => {
    const memory = remembered(memoryStore(), "s", 1, readKeptSections);
    const here = createSectionsStore(deps([stats("anime"), stats("other")], { memory }).deps);
    here.refresh("u1");
    await settle();
    const there = createSectionsStore(deps([stats("anime"), stats("other")], { memory }).deps);
    there.refresh("u1");
    await settle();

    await there.setFollowing("anime", true);
    expect(memory.recall("sections")?.sections[0]).toMatchObject({ id: "anime", following: true });
    here.adoptKept();
    expect(here.get().sections.find((one) => one.id === "anime")?.following).toBe(true);

    await there.setFollowing("anime", false);
    here.adoptKept();
    expect(here.get().sections.find((one) => one.id === "anime")?.following).toBe(false);
  });

  it("puts back only the section refused, not another follow made meanwhile", async () => {
    let refuse!: (reason: unknown) => void;
    const { deps: given } = deps(
      [stats("games", { following: true }), stats("music", { following: true })],
      {
        unfollow: vi.fn((id: string) =>
          id === "games"
            ? new Promise((_, reject) => (refuse = reject))
            : Promise.resolve({ following: false }),
        ),
      },
    );
    const store = createSectionsStore(given);
    store.refresh("u1");
    await settle();
    const games = store.setFollowing("games", false);
    await expect(store.setFollowing("music", false)).resolves.toBeNull();
    refuse(new Error("no"));
    await expect(games).resolves.not.toBeNull();
    const following = Object.fromEntries(
      store.get().sections.map((section) => [section.id, section.following]),
    );
    expect(following).toEqual({ games: true, music: false });
  });
});

describe("SectionGrid", () => {
  it("draws only the places of the sections until they are known", () => {
    render(
      <MemoryRouter>
        <SectionGrid sections={sectionsFrom(null)} width="expanded" known={false} />
      </MemoryRouter>,
    );
    const grid = screen.getByRole("navigation", { name: "Categories" });
    expect(grid).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(grid.querySelectorAll(".section-tile--blank")).toHaveLength(9);
  });

  it("draws every one of the nine on a wide screen, each a link to its page, with no count of new lists", () => {
    const sections = sectionsFrom([
      stats("anime", { newThisWeek: 2 }),
      ...["film_tv", "games", "music", "books", "food", "sport", "people", "other"].map((id) =>
        stats(id, { newThisWeek: id === "other" ? 5 : 0 }),
      ),
    ]);
    render(
      <MemoryRouter>
        <SectionGrid sections={sections} width="expanded" />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(9);
    expect(screen.getByRole("link", { name: /Anime/ })).toHaveAttribute("href", "/s/anime");
    // A small count makes the place look empty, a big one is noise: no tile says one.
    expect(screen.getByRole("link", { name: /Anime/ })).toHaveTextContent(/Anime$/);
    expect(screen.queryByText(/new this week/)).toBeNull();
    expect(document.querySelector(".section-tile__new")).toBeNull();
  });

  it("shows the first twenty and leads to all the sections past them", () => {
    const sections = sectionsFrom(
      Array.from({ length: 22 }, (_, at) => stats(`s-${at}`, { name: `Section ${at}` })),
    );
    render(
      <MemoryRouter>
        <SectionGrid sections={sections} width="compact" />
      </MemoryRouter>,
    );
    const all = screen.getByRole("link", { name: /All sections/ });
    expect(all).toHaveAttribute("href", "/s");
    expect(all).toHaveTextContent("22 sections");
    expect(screen.getAllByRole("link")).toHaveLength(21);
  });
});
