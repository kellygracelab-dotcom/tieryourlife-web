import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { SectionStats } from "../../api/sections";
import { sectionsFrom } from "./model";
import { SectionGrid } from "./SectionGrid";
import { createSectionsStore, SECTIONS_FRESH_MS, type SectionsDeps } from "./useSections";

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
    await expect(pending).resolves.toBe(false);
    expect(store.get().sections.map((section) => section.id)).toEqual(["anime", "games", "other"]);
    expect(refuse).toHaveBeenCalledWith("games");
  });
});

describe("SectionGrid", () => {
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

  it("leads to all the sections from the last slot when they do not fit", () => {
    const sections = sectionsFrom(
      Array.from({ length: 12 }, (_, at) => stats(`s-${at}`, { name: `Section ${at}` })),
    );
    render(
      <MemoryRouter>
        <SectionGrid sections={sections} width="compact" />
      </MemoryRouter>,
    );
    const all = screen.getByRole("link", { name: /All sections/ });
    expect(all).toHaveAttribute("href", "/s");
    expect(all).toHaveTextContent("12 sections");
    expect(screen.getAllByRole("link")).toHaveLength(9);
  });
});
