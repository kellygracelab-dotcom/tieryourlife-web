import { describe, expect, it, vi } from "vitest";
import type { CatalogueItem } from "../../api/catalogue";
import {
  cardsFor,
  PASTE_AT_ONCE,
  PASTE_PACE_MS,
  pick,
  preferredFor,
  wantedOf,
  type PastedCard,
} from "./paste";

const card = (
  id: string,
  title: string,
  subtitle: string | null = null,
  imageUrl: string | null = `https://img/${id}.jpg`,
): CatalogueItem => ({ id, title, subtitle, imageUrl });

describe("wantedOf", () => {
  it("takes one name to a line, without the marks of the list it came from", () => {
    const text = "1. Toy Story\n2) Up\n- WALL·E\n• Coco\n\n   Soul   \n* Luca";
    expect(wantedOf(text, 100).map((one) => one.title)).toEqual([
      "Toy Story",
      "Up",
      "WALL·E",
      "Coco",
      "Soul",
      "Luca",
    ]);
  });

  it("takes a year in brackets off the name and keeps it beside", () => {
    expect(wantedOf("Dune (2021)\nDune (1984)\nUp\nBlade Runner 2049", 100)).toEqual([
      { title: "Dune", year: "2021" },
      { title: "Dune", year: "1984" },
      { title: "Up", year: null },
      { title: "Blade Runner 2049", year: null },
    ]);
  });

  it("takes each name once, whatever its case, and no more than there is room for", () => {
    expect(wantedOf("Up\nUP\nup\nCoco", 100).map((one) => one.title)).toEqual(["Up", "Coco"]);
    expect(wantedOf("One\nTwo\nThree", 2).map((one) => one.title)).toEqual(["One", "Two"]);
    expect(wantedOf("One\nTwo", 0)).toEqual([]);
  });
});

describe("pick", () => {
  it("takes the first card of exactly that name, and nothing for a near miss", () => {
    const found = [card("tmdb:1", "Up in the Air"), card("tmdb:2", "up"), card("tmdb:3", "Up")];
    expect(pick({ title: "Up", year: null }, found)?.id).toBe("tmdb:2");
    expect(pick({ title: "Upside", year: null }, found)).toBeNull();
    expect(pick({ title: "Up", year: null }, [])).toBeNull();
  });

  it("with a year, takes only the card that carries it", () => {
    const found = [
      card("tmdb:1", "Dune", "1984"),
      card("tmdb:2", "Dune", "2021"),
      card("wikidata:Q1", "Dune", "2021 film by Denis Villeneuve"),
    ];
    expect(pick({ title: "Dune", year: "2021" }, found)?.id).toBe("tmdb:2");
    expect(pick({ title: "Dune", year: "1984" }, found)?.id).toBe("tmdb:1");
    expect(pick({ title: "Dune", year: "2000" }, found)).toBeNull();
  });
});

describe("the catalogue a pasted name is taken from", () => {
  // The order the two catalogues come merged in: best match, then a picture.
  const found = [
    card("tmdb:9", "Pizza", "2012"),
    card("wikidata:Q177", "pizza", "Italian dish"),
    card("wikidata:Q9", "Pizza", "album", null),
  ];

  it("is TMDB for films, anime and people, and Wikidata for everything else", () => {
    expect(preferredFor("film_tv")).toBe("tmdb");
    expect(preferredFor("anime")).toBe("tmdb");
    expect(preferredFor("people")).toBe("tmdb");
    expect(preferredFor("food")).toBe("wikidata");
    expect(preferredFor("games")).toBe("wikidata");
    expect(preferredFor("other")).toBe("wikidata");
    expect(preferredFor(null)).toBeNull();
  });

  it("gives a list of food the dish, not the poster of a film by that name", () => {
    expect(pick({ title: "Pizza", year: null }, found, "wikidata")?.id).toBe("wikidata:Q177");
    expect(pick({ title: "Pizza", year: null }, found, "tmdb")?.id).toBe("tmdb:9");
    // Nothing said about the list yet: the catalogue's own order.
    expect(pick({ title: "Pizza", year: null }, found)?.id).toBe("tmdb:9");
    // The year still decides before the catalogue does.
    expect(pick({ title: "Pizza", year: "2012" }, found, "wikidata")?.id).toBe("tmdb:9");
  });

  it("falls back on the other catalogue when the preferred one knows nothing by that name", () => {
    const film = [card("tmdb:9", "Pizza", "2012"), card("wikidata:Q1", "Pizza Hut", "chain")];
    expect(pick({ title: "Pizza", year: null }, film, "wikidata")?.id).toBe("tmdb:9");
    const thing = [card("wikidata:Q2", "Ayran", "drink", null)];
    expect(pick({ title: "Ayran", year: null }, thing, "tmdb")?.id).toBe("wikidata:Q2");
  });

  it("takes no film's poster for a thing when Wikidata did not answer", () => {
    // Nothing of Wikidata's at all: it failed, or was asked too often.
    const films = [card("tmdb:9", "Pizza", "2012"), card("tmdb:10", "Pizza Man", "1991")];
    expect(pick({ title: "Pizza", year: null }, films, "wikidata")).toBeNull();
    // A list of films loses nothing by it, and neither does one about nothing yet.
    expect(pick({ title: "Pizza", year: null }, films, "tmdb")?.id).toBe("tmdb:9");
    expect(pick({ title: "Pizza", year: null }, films)?.id).toBe("tmdb:9");
  });

  it("is passed on to every name of a pasted list, and the name stays as it was written", async () => {
    const got: PastedCard[] = [];
    await cardsFor(
      wantedOf("Pizza", 100),
      async () => found,
      (one) => got.push(one),
      { preferred: "wikidata" },
    );
    // Wikidata writes "pizza"; the card says what its maker wrote.
    expect(got).toEqual([
      { title: "Pizza", imageUrl: "https://img/wikidata:Q177.jpg", key: "wikidata:Q177" },
    ]);
  });
});

describe("cardsFor", () => {
  it("hands the cards over in the order pasted, a few at a time, with their pictures", async () => {
    const asked: string[] = [];
    const lookup = vi.fn(async (query: string) => {
      asked.push(query);
      if (query === "Broken") throw new Error("offline");
      return query === "Nobody" ? [] : [card(`tmdb:${query}`, query, "1999")];
    });
    const got: [PastedCard, number][] = [];
    const wanted = wantedOf("One\nTwo\nNobody\nBroken\nFive", 100);

    await cardsFor(wanted, lookup, (one, done) => got.push([one, done]), { paceMs: 0 });

    expect(asked).toEqual(["One", "Two", "Nobody", "Broken", "Five"]);
    expect(got).toEqual([
      [{ title: "One", imageUrl: "https://img/tmdb:One.jpg", key: "tmdb:One" }, 1],
      [{ title: "Two", imageUrl: "https://img/tmdb:Two.jpg", key: "tmdb:Two" }, 2],
      // The catalogue knows nobody by that name, or does not answer: the name alone.
      [{ title: "Nobody", imageUrl: null }, 3],
      [{ title: "Broken", imageUrl: null }, 4],
      [{ title: "Five", imageUrl: "https://img/tmdb:Five.jpg", key: "tmdb:Five" }, 5],
    ]);
    expect(PASTE_AT_ONCE).toBe(3);
  });

  it("keeps to a pace between the few, and waits for nothing after the last", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const got: string[] = [];
    const done = cardsFor(
      wantedOf("1\n2\n3\n4", 100),
      async (query) => {
        asked.push(query);
        return [];
      },
      (one) => got.push(one.title),
    );
    await vi.advanceTimersByTimeAsync(PASTE_PACE_MS - 1);
    // The answers are in, and the next few are not asked for yet.
    expect(asked).toEqual(["1", "2", "3"]);
    expect(got).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual(["1", "2", "3", "4"]);
    await done;
    expect(got).toEqual(["1", "2", "3", "4"]);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("stops when the box is gone", async () => {
    const got: PastedCard[] = [];
    let going = true;
    await cardsFor(
      wantedOf("1\n2\n3\n4\n5\n6", 100),
      async (query) => [card(`tmdb:${query}`, query)],
      (one) => {
        got.push(one);
        going = false;
      },
      { going: () => going, paceMs: 0 },
    );
    // The first few had been asked for together; nothing is asked after them.
    expect(got.map((one) => one.title)).toEqual(["1", "2", "3"]);
  });
});
