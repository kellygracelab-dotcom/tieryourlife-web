import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { LinkAsk } from "../../api/pictures";
import type { CatalogueItem } from "../../api/types";
import { LinkRefused, type LinkedPicture } from "../../lib/linkPictures";
import {
  BUSY_FALLBACK_MS,
  BUSY_TRIES,
  BUSY_WAIT_MAX_MS,
  busyUntil,
  cardsFor,
  PASTE_AT_ONCE,
  PASTE_PACE_MS,
  looseIn,
  pick,
  plainName,
  preferredFor,
  sourcesCount,
  waitsForIn,
  wantedOf,
  type LookedUp,
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

  it("takes Wikidata's number in brackets for the subject itself", () => {
    expect(
      wantedOf("Orange (Q13191)\n2. Football (Q2736)\nOrange (Q39338)\nQ (Q9950)", 100),
    ).toEqual([
      { title: "Orange", year: null, id: "wikidata:Q13191" },
      { title: "Football", year: null, id: "wikidata:Q2736" },
      // The colour is another subject of the same name, and another card.
      { title: "Orange", year: null, id: "wikidata:Q39338" },
      { title: "Q", year: null, id: "wikidata:Q9950" },
    ]);
    // Brackets that hold anything else are the name's own.
    expect(wantedOf("Everybody (Backstreet's Back)\nQ (q13191)", 100)).toEqual([
      { title: "Everybody (Backstreet's Back)", year: null },
      { title: "Q (q13191)", year: null },
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

describe("pick, when the search says how sure it is", () => {
  const judged = (
    id: string,
    title: string,
    confidence: "high" | "medium" | "low",
    subtitle: string | null = null,
  ) => ({ ...card(id, title, subtitle), confidence });

  it("takes the first hit it is sure enough of, under another name too", () => {
    const found = [
      judged("wikidata:Q1", "Kiev Oblast", "low"),
      judged("wikidata:Q2", "Kyiv", "medium"),
      judged("wikidata:Q3", "Kyiv", "high"),
    ];
    expect(pick({ title: "Киев", year: null }, found)?.id).toBe("wikidata:Q2");
  });

  it("takes nothing when every hit is doubtful, even one of exactly that name", () => {
    const found = [judged("tmdb:1", "Up", "low"), judged("tmdb:2", "Up", "low")];
    expect(pick({ title: "Up", year: null }, found)).toBeNull();
  });

  it("with a year, takes the first sure hit that carries it", () => {
    const found = [
      judged("tmdb:1", "Dune", "high", "1984"),
      judged("tmdb:2", "Dune", "medium", "2021"),
      judged("tmdb:3", "Dune", "low", "2000"),
    ];
    expect(pick({ title: "Dune", year: "2021" }, found)?.id).toBe("tmdb:2");
    expect(pick({ title: "Dune", year: "2000" }, found)).toBeNull();
  });

  it("takes the web's first picture when every catalogue hit is doubtful", () => {
    const web = (id: string) => ({
      ...card(id, "Some page"),
      confidence: "low" as const,
      doubts: ["web" as const],
    });
    const found = [judged("tmdb:1", "Upside", "low"), web("web:1"), web("web:2")];
    expect(pick({ title: "Up", year: null }, found)?.id).toBe("web:1");
    // A sure catalogue hit comes before the web, and a year does not keep the web out.
    expect(
      pick({ title: "Up", year: null }, [web("web:1"), judged("tmdb:2", "Up", "high")])?.id,
    ).toBe("tmdb:2");
    expect(pick({ title: "Up", year: "2009" }, found)?.id).toBe("web:1");
  });
});

describe("a pasted name in a section with catalogues of its own", () => {
  // IGDB's answers for a search, in its own order, as the proxy hands them on.
  const mario = [
    card("igdb:1074", "Super Mario 64", "1996"),
    card("igdb:358", "Super Mario Bros.", "1985"),
    card("igdb:26758", "Super Mario Odyssey", "2017"),
    card("igdb:2349", "Mario Kart 8 Deluxe", "2017"),
  ];
  const zelda = [
    card("igdb:7346", "The Legend of Zelda: Breath of the Wild", "2017"),
    card("igdb:1022", "The Legend of Zelda", "1986"),
    card("igdb:119388", "The Legend of Zelda: Tears of the Kingdom", "2023"),
  ];
  const pokemon = [
    card("igdb:1514", "Pokémon Red", "1996"),
    card("igdb:1561", "Pokémon Blue", "1996"),
    card("igdb:119133", "Pokémon Scarlet", "2022"),
  ];
  const games = looseIn("games");

  it("loosens the name in a section of its own catalogues only", () => {
    for (const own of ["games", "anime", "film_tv", "people", "music", "books"]) {
      expect(looseIn(own)).toBe(true);
    }
    expect(looseIn("food")).toBe(false);
    expect(looseIn("other")).toBe(false);
    expect(looseIn(null)).toBe(false);
  });

  it("takes the catalogue's best card with every word of a name no card carries exactly", () => {
    expect(pick({ title: "Mario", year: null }, mario, null, games)?.id).toBe("igdb:1074");
    expect(pick({ title: "Zelda", year: null }, zelda, null, games)?.id).toBe("igdb:7346");
    expect(pick({ title: "Pokémon", year: null }, pokemon, null, games)?.id).toBe("igdb:1514");
    // Without its accent too.
    expect(pick({ title: "Pokemon", year: null }, pokemon, null, games)?.id).toBe("igdb:1514");
    // A year still decides.
    expect(pick({ title: "Mario", year: "2017" }, mario, null, games)?.id).toBe("igdb:26758");
  });

  it("takes the card of exactly the name first, wherever the catalogue put it", () => {
    expect(pick({ title: "Super Mario Odyssey", year: null }, mario, null, games)?.id).toBe(
      "igdb:26758",
    );
    expect(
      pick({ title: "The Legend of Zelda: Breath of the Wild", year: null }, zelda, null, games)
        ?.id,
    ).toBe("igdb:7346");
    // Its punctuation as one types it, without the colon.
    expect(
      pick({ title: "the legend of zelda breath of the wild", year: null }, zelda, null, games)?.id,
    ).toBe("igdb:7346");
    expect(pick({ title: "The Legend of Zelda", year: null }, zelda, null, games)?.id).toBe(
      "igdb:1022",
    );
  });

  it("takes nothing that lacks a word of the name, and nothing loose elsewhere", () => {
    expect(pick({ title: "Mario Party", year: null }, mario, null, games)).toBeNull();
    expect(
      pick({ title: "Upside", year: null }, [card("tmdb:1", "Up in the Air")], null, true),
    ).toBeNull();
    // A list about nothing yet, or of food: exactly the name or nothing.
    expect(pick({ title: "Mario", year: null }, mario)).toBeNull();
    expect(pick({ title: "Mario", year: null }, mario, "wikidata", false)).toBeNull();
  });

  // Content on the live site, 15.11.2026: "Mario" took the singer's photo,
  // "Zelda" a pet's, "Pokémon" Pokémon Stadium.
  it("takes its own catalogues' card before Wikidata's, and of a series the most rated game", () => {
    const singer = card("wikidata:Q295463", "Mario", "American singer");
    const pet = card("wikidata:Q1", "Zelda", "dog");
    expect(pick({ title: "Mario", year: null }, [singer, ...mario], null, games)?.id).toBe(
      "igdb:1074",
    );
    expect(pick({ title: "Zelda", year: null }, [pet, ...zelda], null, games)?.id).toBe(
      "igdb:7346",
    );
    const rated = (id: string, title: string, popularity: number) => ({
      ...card(id, title, null),
      popularity,
    });
    const series = [
      rated("igdb:2286", "Pokémon Stadium", 120),
      rated("igdb:1514", "Pokémon Red", 2400),
      rated("igdb:119133", "Pokémon Scarlet", 900),
      card("igdb:5", "Pokémon Puzzle League", null),
    ];
    expect(pick({ title: "Pokémon", year: null }, series, null, games)?.id).toBe("igdb:1514");
    // A card of exactly the name is still the one, however few rated it.
    expect(pick({ title: "Pokémon Stadium", year: null }, series, null, games)?.id).toBe(
      "igdb:2286",
    );
    // Wikidata's card of the name only when the section's catalogues know nothing like it.
    expect(pick({ title: "Mario", year: null }, [singer], null, games)?.id).toBe(
      "wikidata:Q295463",
    );
    expect(
      pick(
        { title: "Mario", year: null },
        [card("wikidata:Q2", "Mario Lemieux", null)],
        null,
        games,
      ),
    ).toBeNull();
  });

  // Content on the live site, 15.11.2026: "Zelda" took IGDB's own record of that name.
  it("gives the card of exactly the name up only to a game of the series far more rated", () => {
    const rated = (id: string, title: string, popularity?: number) => ({
      ...card(id, title, null),
      ...(popularity === undefined ? {} : { popularity }),
    });
    const zeldas = [
      rated("igdb:5", "Zelda", 14),
      rated("igdb:1022", "The Legend of Zelda", 610),
      rated("igdb:7346", "The Legend of Zelda: Breath of the Wild", 3100),
    ];
    expect(pick({ title: "Zelda", year: null }, zeldas, null, games)?.id).toBe("igdb:7346");
    // Five times as rated is not enough: the 1986 game is the one asked for.
    expect(pick({ title: "The Legend of Zelda", year: null }, zeldas, null, games)?.id).toBe(
      "igdb:1022",
    );
    // A record nobody rated gives way to a game ten people did.
    const unrated = [rated("igdb:6", "Tetris"), rated("igdb:7", "Tetris Effect", 10)];
    expect(pick({ title: "Tetris", year: null }, unrated, null, games)?.id).toBe("igdb:7");
    // Where nothing is rated, the name is the one.
    expect(
      pick(
        { title: "Mario", year: null },
        [card("igdb:9", "Mario Kart"), card("igdb:8", "Mario")],
        null,
        games,
      )?.id,
    ).toBe("igdb:8");
  });

  it("compares names without case, accents or punctuation", () => {
    expect(plainName("Pokémon: Let's Go, Pikachu!")).toBe("pokemon let s go pikachu");
    expect(plainName("Ratchet & Clank")).toBe(plainName("Ratchet and Clank"));
    expect(plainName("  ")).toBe("");
  });

  it("is passed on to every name of a pasted list", async () => {
    const lookup = vi.fn(async (query: string) =>
      query === "Zelda" ? zelda : query.includes("Mario") ? mario : [],
    );
    const cards: PastedCard[] = [];
    await cardsFor(
      wantedOf(["Mario", "Zelda", "Super Mario Odyssey"].join("\n"), 10),
      lookup,
      (one) => cards.push(one),
      { loose: true, paceMs: 0 },
    );
    expect(cards.map((one) => [one.title, one.imageUrl])).toEqual([
      ["Mario", "https://img/igdb:1074.jpg"],
      ["Zelda", "https://img/igdb:7346.jpg"],
      ["Super Mario Odyssey", "https://img/igdb:26758.jpg"],
    ]);
  });
});

describe("a line that gives the subject's id", () => {
  const found = [
    card("wikidata:Q187796", "Orange", "commune in Vaucluse, France"),
    card("tmdb:7", "Orange", "2010"),
    card("wikidata:Q13191", "orange", "citrus fruit"),
    card("wikidata:Q2736", "association football", "team sport", null),
  ];

  it("gets that subject, whatever else carries the name", () => {
    const fruit = { title: "Orange", year: null, id: "wikidata:Q13191" };
    expect(pick(fruit, found)?.id).toBe("wikidata:Q13191");
    expect(pick(fruit, found, "tmdb")?.id).toBe("wikidata:Q13191");
    expect(pick(fruit, found, "wikidata")?.id).toBe("wikidata:Q13191");
  });

  it("gets it under the name the line gives, not the catalogue's", () => {
    const game = { title: "Football", year: null, id: "wikidata:Q2736" };
    expect(pick(game, found)?.id).toBe("wikidata:Q2736");
  });

  it("gets nothing when the subject is not among the answers, even with the name there", () => {
    const colour = { title: "Orange", year: null, id: "wikidata:Q39338" };
    expect(pick(colour, found)).toBeNull();
    expect(pick(colour, found, "wikidata")).toBeNull();
  });
});

describe("the catalogue a pasted name is taken from", () => {
  // The order the two catalogues come merged in: best match, then a picture.
  const found = [
    card("tmdb:9", "Pizza", "2012"),
    card("wikidata:Q177", "pizza", "Italian dish"),
    card("wikidata:Q9", "Pizza", "album", null),
  ];

  it("takes any card in a section with catalogues of its own, and Wikidata's everywhere else", () => {
    for (const own of ["film_tv", "anime", "people", "games", "music", "books"]) {
      expect(preferredFor(own)).toBeNull();
    }
    expect(preferredFor("food")).toBe("wikidata");
    expect(preferredFor("other")).toBe("wikidata");
    expect(preferredFor("knitting")).toBe("wikidata");
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

    // Whoever said nothing is asked once more before the name goes alone.
    expect(asked).toEqual(["One", "Two", "Nobody", "Nobody", "Broken", "Five", "Broken"]);
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

  it("gives each card its picture's attribution, and none where the catalogue said none", async () => {
    const tmdb = { source: "tmdb", link: "https://www.themoviedb.org/movie/1" };
    const got: PastedCard[] = [];
    await cardsFor(
      wantedOf(["Dune", "Heat"].join("\n"), 100),
      async (query) => [
        query === "Dune"
          ? { ...card("tmdb:1", "Dune"), attribution: tmdb }
          : { ...card("tmdb:2", "Heat"), attribution: null },
      ],
      (one) => got.push(one),
      { paceMs: 0 },
    );
    expect(got[0]).toMatchObject({ title: "Dune", attribution: tmdb });
    expect(got[1]).not.toHaveProperty("attribution");
  });

  it("keeps to a pace between the few, and waits for nothing after the last", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const got: string[] = [];
    const done = cardsFor(
      wantedOf("1\n2\n3\n4", 100),
      async (query) => {
        asked.push(query);
        return [card(`tmdb:${query}`, query)];
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
  });

  it("asks once more when the catalogue the name is for said nothing", async () => {
    const dish = card("wikidata:Q177", "pizza", "Italian dish");
    const film = card("tmdb:9", "Pizza", "2012");
    const answers = [[film], [film, dish]];
    const lookup = vi.fn(async () => answers.shift() ?? []);
    const got: PastedCard[] = [];

    await cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
      preferred: "wikidata",
      paceMs: 0,
    });

    // Wikidata was busy the first time; the film's poster was not taken for the dish.
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(got).toEqual([
      { title: "Pizza", imageUrl: "https://img/wikidata:Q177.jpg", key: "wikidata:Q177" },
    ]);
  });

  it("asks a second time at most, and keeps what the first answer had", async () => {
    const film = card("tmdb:9", "Pizza", "2012");
    const lookup = vi.fn(async () => [film]);
    const got: PastedCard[] = [];
    const wanted = wantedOf("Pizza\nPizza (Q177)", 100);

    await cardsFor(wanted, lookup, (one) => got.push(one), { preferred: "wikidata", paceMs: 0 });

    expect(lookup).toHaveBeenCalledTimes(4);
    expect(got).toEqual([
      { title: "Pizza", imageUrl: null },
      { title: "Pizza", imageUrl: null },
    ]);

    // A list of films asks TMDB's own way, and takes what Wikidata has when TMDB has nothing.
    lookup.mockClear();
    got.length = 0;
    const dish = card("wikidata:Q177", "pizza", "Italian dish");
    lookup.mockResolvedValue([dish]);
    await cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
      preferred: "tmdb",
      paceMs: 0,
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(got).toEqual([
      { title: "Pizza", imageUrl: "https://img/wikidata:Q177.jpg", key: "wikidata:Q177" },
    ]);
  });

  it("asks for a subject by its number, and gives the card the name of the line", async () => {
    const asked: string[] = [];
    const got: PastedCard[] = [];
    await cardsFor(
      wantedOf("Muse (Q22151)\nMuse", 100),
      async (query) => {
        asked.push(query);
        // A search by the name does not reach the band; its number does.
        return query === "Q22151"
          ? [card("wikidata:Q22151", "Muse", "English rock band")]
          : [card("wikidata:Q16877643", "Muse", "family name", null)];
      },
      (one) => got.push(one),
      { preferred: "wikidata", paceMs: 0 },
    );
    expect(asked).toEqual(["Q22151", "Muse"]);
    expect(got).toEqual([
      { title: "Muse", imageUrl: "https://img/wikidata:Q22151.jpg", key: "wikidata:Q22151" },
      { title: "Muse", imageUrl: null, key: "wikidata:Q16877643" },
    ]);
  });

  it("asks nothing more once the searches ran out, and says how many names went alone and when", async () => {
    const asked: string[] = [];
    const lookup = vi.fn(async (query: string) => {
      asked.push(query);
      if (query === "Two")
        throw new ApiFailure({ kind: "searchLimit", retryAt: 1_794_571_200_000 });
      return query === "Three" ? [] : [card(`tmdb:${query}`, query)];
    });
    const got: [PastedCard, number][] = [];
    const wanted = wantedOf("One\nTwo\nThree\nFour\nFive", 100);

    const limited = await cardsFor(wanted, lookup, (one, done) => got.push([one, done]), {
      paceMs: 0,
    });

    // The first few were asked together; nothing after the refusal, not even
    // the second question for Three, which said nothing.
    expect(asked).toEqual(["One", "Two", "Three"]);
    expect(got).toEqual([
      [{ title: "One", imageUrl: "https://img/tmdb:One.jpg", key: "tmdb:One" }, 1],
      [{ title: "Two", imageUrl: null }, 2],
      [{ title: "Three", imageUrl: null }, 3],
      [{ title: "Four", imageUrl: null }, 4],
      [{ title: "Five", imageUrl: null }, 5],
    ]);
    expect(limited).toEqual({ unanswered: 3, retryAt: 1_794_571_200_000 });
  });

  it("says nothing of a limit when the searches did not run out", async () => {
    const lookup = vi.fn(async (query: string) => [card(`tmdb:${query}`, query)]);
    await expect(cardsFor(wantedOf("One", 10), lookup, () => {}, { paceMs: 0 })).resolves.toBe(
      null,
    );
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

describe("a pasted line with its own picture", () => {
  it("takes the picture's address after the name, and a second address as its page", () => {
    expect(
      wantedOf(
        [
          "Dune https://img.test/dune.jpg",
          "1. Arrival (2016) https://img.test/arrival.jpg https://site.test/arrival",
          "- Heat   http://img.test/heat.jpg   ",
          "Plain name",
        ].join("\n"),
        100,
      ),
    ).toEqual([
      { title: "Dune", year: null, picture: "https://img.test/dune.jpg" },
      {
        title: "Arrival",
        year: "2016",
        picture: "https://img.test/arrival.jpg",
        page: "https://site.test/arrival",
      },
      { title: "Heat", year: null, picture: "http://img.test/heat.jpg" },
      { title: "Plain name", year: null },
    ]);
  });

  it("leaves out a page the backend would not keep, and keeps the picture", () => {
    expect(wantedOf("Dune https://img.test/dune.jpg http://site.test/dune", 100)).toEqual([
      { title: "Dune", year: null, picture: "https://img.test/dune.jpg" },
    ]);
  });

  it("takes a link alone for a card without a name, and one name with two pictures twice", () => {
    expect(
      wantedOf(
        "https://img.test/a.jpg\nDune https://img.test/1.jpg\nDune https://img.test/2.jpg",
        100,
      ),
    ).toEqual([
      { title: "", year: null, picture: "https://img.test/a.jpg" },
      { title: "Dune", year: null, picture: "https://img.test/1.jpg" },
      { title: "Dune", year: null, picture: "https://img.test/2.jpg" },
    ]);
  });

  it("reads the house's «Name | picture link | page» on a house board only", () => {
    const text = "Dune | https://img.test/dune.jpg | https://site.test/dune\nHeat|not a link|";
    expect(wantedOf(text, 100, true)).toEqual([
      {
        title: "Dune",
        year: null,
        picture: "https://img.test/dune.jpg",
        page: "https://site.test/dune",
      },
      { title: "Heat", year: null },
    ]);
    // Everyone else's line is its name, bars and all.
    expect(wantedOf("Dune | Part Two", 100)).toEqual([{ title: "Dune | Part Two", year: null }]);
    // The house may write a line the plain way too.
    expect(wantedOf("Dune https://img.test/dune.jpg https://site.test/dune", 100, true)).toEqual([
      {
        title: "Dune",
        year: null,
        picture: "https://img.test/dune.jpg",
        page: "https://site.test/dune",
      },
    ]);
  });

  it("takes a house line with its page column empty, or left out", () => {
    const text = [
      "Mango | https://commons.wikimedia.org/wiki/File:Mangos_-_single_and_halved.jpg",
      "Kiwi | https://img.test/kiwi.jpg |",
      "Fig | https://img.test/fig.jpg |   ",
    ].join("\n");
    expect(wantedOf(text, 100, true)).toEqual([
      {
        title: "Mango",
        year: null,
        picture: "https://commons.wikimedia.org/wiki/File:Mangos_-_single_and_halved.jpg",
      },
      { title: "Kiwi", year: null, picture: "https://img.test/kiwi.jpg" },
      { title: "Fig", year: null, picture: "https://img.test/fig.jpg" },
    ]);
  });

  it("counts the cards from the catalogue and the ones from links", () => {
    expect(
      sourcesCount(
        wantedOf("One\nTwo https://img.test/2.jpg\nThree\nFour https://img.test/4.jpg", 100),
      ),
    ).toEqual({ catalogue: 2, links: 2 });
  });
});

describe("cardsFor, with pictures from links", () => {
  const linked = (url: string, more: Partial<LinkedPicture> = {}): LinkedPicture => ({
    imageUrl: `${url}#copy`,
    pictureId: "p1",
    attribution: { source: "web" },
    credit: null,
    quota: { left: 9, limit: 50, resetsAt: 5 },
    ...more,
  });

  it("keeps a line's own picture without asking the catalogue, its page on the attribution", async () => {
    const lookup = vi.fn(async (query: string) => [card(`tmdb:${query}`, query)]);
    const link = vi.fn(async (ask: LinkAsk) => linked(ask.url));
    const onQuota = vi.fn();
    const got: PastedCard[] = [];
    await cardsFor(
      wantedOf("Dune https://img.test/dune.jpg https://site.test/dune\nHeat", 100),
      lookup,
      (one) => got.push(one),
      { paceMs: 0, link, onQuota },
    );
    expect(link).toHaveBeenCalledWith({
      url: "https://img.test/dune.jpg",
      link: "https://site.test/dune",
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(got).toEqual([
      {
        title: "Dune",
        imageUrl: "https://img.test/dune.jpg#copy",
        pictureId: "p1",
        attribution: { source: "web", link: "https://site.test/dune" },
      },
      { title: "Heat", imageUrl: "https://img/tmdb:Heat.jpg", key: "tmdb:Heat" },
    ]);
    expect(onQuota).toHaveBeenCalledWith({ left: 9, limit: 50, resetsAt: 5 });
  });

  it("copies the web picture a name took, with the page it stands on, and keeps the hit as its origin", async () => {
    const hit = {
      ...card("web:abc", "Borscht recipe", null, "https://cdn.site.test/borscht.jpg"),
      confidence: "low" as const,
      doubts: ["web" as const],
      attribution: { source: "web", link: "https://site.test/borscht" },
    };
    const link = vi.fn(async (ask: LinkAsk) =>
      linked(ask.url, { attribution: { source: "web", link: "https://site.test/borscht" } }),
    );
    const got: { card: PastedCard; found: CatalogueItem | null }[] = [];
    await cardsFor(
      wantedOf("Borscht", 100),
      async () => [hit],
      (one, _done, from) => got.push({ card: one, found: from.found }),
      { paceMs: 0, link },
    );
    expect(link).toHaveBeenCalledWith({
      url: "https://cdn.site.test/borscht.jpg",
      link: "https://site.test/borscht",
    });
    expect(got).toEqual([
      {
        card: {
          title: "Borscht",
          imageUrl: "https://cdn.site.test/borscht.jpg#copy",
          pictureId: "p1",
          key: "web:abc",
          attribution: { source: "web", link: "https://site.test/borscht" },
        },
        found: hit,
      },
    ]);

    // Signed out, nothing can be copied: the name goes alone, and says why.
    const alone: PastedCard[] = [];
    await cardsFor(
      wantedOf("Borscht", 100),
      async () => [hit],
      (one) => alone.push(one),
      {
        paceMs: 0,
      },
    );
    expect(alone).toEqual([{ title: "Borscht", imageUrl: null }]);
  });

  it("keeps a catalogue's own attribution and credit, its page untouched", async () => {
    const got: PastedCard[] = [];
    const tmdb = { source: "tmdb", link: "https://www.themoviedb.org/movie/1" };
    await cardsFor(
      wantedOf("Dune https://image.tmdb.org/a.jpg https://site.test/dune", 100),
      vi.fn(),
      (one) => got.push(one),
      {
        paceMs: 0,
        link: async () =>
          linked("https://image.tmdb.org/a.jpg", {
            imageUrl: "https://image.tmdb.org/a.jpg",
            pictureId: null,
            attribution: tmdb,
            credit: "TMDB",
            quota: null,
          }),
      },
    );
    expect(got).toEqual([
      {
        title: "Dune",
        imageUrl: "https://image.tmdb.org/a.jpg",
        credit: "TMDB",
        attribution: tmdb,
      },
    ]);
  });

  it("gives a refused line its name alone, and says why", async () => {
    const onMissing = vi.fn();
    const onQuota = vi.fn();
    const got: PastedCard[] = [];
    const quota = { left: 3, limit: 50, resetsAt: 5 };
    await cardsFor(
      wantedOf("Page https://site.test/page\nNobody", 100),
      async () => [],
      (one) => got.push(one),
      {
        paceMs: 0,
        onMissing,
        onQuota,
        link: async () => {
          throw new LinkRefused("notAPicture", null, quota);
        },
      },
    );
    expect(got).toEqual([
      { title: "Page", imageUrl: null },
      { title: "Nobody", imageUrl: null },
    ]);
    expect(onMissing.mock.calls).toEqual([
      ["Page", "notAPicture"],
      ["Nobody", "notFound"],
    ]);
    expect(onQuota).toHaveBeenCalledWith(quota);
  });

  it("gives a guest's lines with a picture their names alone: pictures belong to an account", async () => {
    const onMissing = vi.fn();
    const got: PastedCard[] = [];
    await cardsFor(
      wantedOf("Dune https://img.test/dune.jpg", 100),
      vi.fn(),
      (one) => got.push(one),
      { onMissing },
    );
    expect(got).toEqual([{ title: "Dune", imageUrl: null }]);
    expect(onMissing).toHaveBeenCalledWith("Dune", "signIn");
  });

  it("says a name went alone for the search limit", async () => {
    const onMissing = vi.fn();
    await cardsFor(
      wantedOf("Dune", 100),
      async () => {
        throw new ApiFailure({ kind: "searchLimit", retryAt: 9 });
      },
      () => undefined,
      { paceMs: 0, onMissing },
    );
    expect(onMissing).toHaveBeenCalledWith("Dune", "searchLimit");
  });

  it("does not wait between links alone", async () => {
    vi.useFakeTimers();
    try {
      const got: PastedCard[] = [];
      const done = cardsFor(
        wantedOf([1, 2, 3, 4].map((n) => `${n} https://img.test/${n}.jpg`).join("\n"), 100),
        vi.fn(),
        (one) => got.push(one),
        { link: async (ask) => linked(ask.url) },
      );
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(got).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a Commons address as the catalogue's picture, with its attribution", async () => {
    const got: PastedCard[] = [];
    const commons = {
      source: "wikimedia",
      author: "Someone",
      license: "CC BY-SA 4.0",
      link: "https://commons.wikimedia.org/wiki/File:Fuji.jpg",
    };
    const url = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fuji.jpg";
    await cardsFor(wantedOf(`Fuji ${url}`, 100), vi.fn(), (one) => got.push(one), {
      paceMs: 0,
      link: async () =>
        linked(url, {
          imageUrl:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fuji.jpg/640px-Fuji.jpg",
          pictureId: null,
          attribution: commons,
          quota: null,
        }),
    });
    expect(got).toEqual([
      {
        title: "Fuji",
        imageUrl:
          "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fuji.jpg/640px-Fuji.jpg",
        attribution: commons,
      },
    ]);
  });

  it("names the pictures copied from another site that came without their page", async () => {
    const onPageless = vi.fn();
    const got: PastedCard[] = [];
    await cardsFor(
      wantedOf(
        [
          "Kiwi | https://img.test/kiwi.jpg |",
          "Fig | https://img.test/fig.jpg | https://site.test/fig",
          "Mango | https://commons.wikimedia.org/wiki/File:Mango.jpg",
          "Dune | https://image.tmdb.org/dune.jpg",
        ].join("\n"),
        100,
        true,
      ),
      vi.fn(),
      (one) => got.push(one),
      {
        paceMs: 0,
        onPageless,
        link: async (ask) =>
          ask.url.includes("commons")
            ? linked(ask.url, {
                imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Mango.jpg",
                pictureId: null,
                attribution: {
                  source: "wikimedia",
                  author: "Someone",
                  link: "https://commons.wikimedia.org/wiki/File:Mango.jpg",
                },
                quota: null,
              })
            : ask.url.includes("tmdb")
              ? linked(ask.url, {
                  imageUrl: ask.url,
                  pictureId: null,
                  attribution: { source: "tmdb" },
                  quota: null,
                })
              : linked(ask.url),
      },
    );
    // Only the copy from another site without a page; all four come as cards.
    expect(onPageless.mock.calls).toEqual([["Kiwi"]]);
    expect(got.map((one) => one.title)).toEqual(["Kiwi", "Fig", "Mango", "Dune"]);
    expect(got[0]).toMatchObject({ pictureId: "p1", attribution: { source: "web" } });
  });

  describe("a busy picture site", () => {
    const START = 1_000_000;

    it("waits until its time, says so, and asks the same line again", async () => {
      vi.useFakeTimers({ now: START });
      try {
        const got: PastedCard[] = [];
        const onWaiting = vi.fn();
        const onQuota = vi.fn();
        const quota = { left: 9, limit: 50, resetsAt: 5 };
        const link = vi
          .fn()
          .mockRejectedValueOnce(new LinkRefused("busy", START + 30_000, quota))
          .mockImplementation(async (ask: LinkAsk) => linked(ask.url));
        const done = cardsFor(
          wantedOf("Dune https://img.test/dune.jpg", 100),
          vi.fn(),
          (one) => got.push(one),
          { link, onWaiting, onQuota },
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(onWaiting).toHaveBeenLastCalledWith(START + 30_000);
        expect(onQuota).toHaveBeenCalledWith(quota);
        expect(link).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(link).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await done;
        expect(link).toHaveBeenCalledTimes(2);
        expect(link.mock.calls[1]).toEqual(link.mock.calls[0]);
        expect(onWaiting.mock.calls).toEqual([[START + 30_000], [null]]);
        expect(got).toEqual([
          expect.objectContaining({ title: "Dune", imageUrl: "https://img.test/dune.jpg#copy" }),
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits a little when the site gave no time", async () => {
      vi.useFakeTimers({ now: START });
      try {
        const onWaiting = vi.fn();
        const link = vi
          .fn()
          .mockRejectedValueOnce(new LinkRefused("busy"))
          .mockImplementation(async (ask: LinkAsk) => linked(ask.url));
        const done = cardsFor(wantedOf("Dune https://img.test/dune.jpg", 100), vi.fn(), vi.fn(), {
          link,
          onWaiting,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(onWaiting).toHaveBeenCalledWith(START + BUSY_FALLBACK_MS);
        await vi.advanceTimersByTimeAsync(BUSY_FALLBACK_MS);
        await done;
        expect(link).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives the name alone when the wait is too long", async () => {
      vi.useFakeTimers({ now: START });
      try {
        const onMissing = vi.fn();
        const onWaiting = vi.fn();
        const got: PastedCard[] = [];
        const link = vi.fn(async () => {
          throw new LinkRefused("busy", START + BUSY_WAIT_MAX_MS + 1);
        });
        await cardsFor(
          wantedOf("Dune https://img.test/dune.jpg", 100),
          vi.fn(),
          (one) => got.push(one),
          { link, onMissing, onWaiting },
        );
        expect(link).toHaveBeenCalledTimes(1);
        expect(onWaiting).not.toHaveBeenCalled();
        expect(got).toEqual([{ title: "Dune", imageUrl: null }]);
        expect(onMissing).toHaveBeenCalledWith("Dune", "busy");
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up after a few tries", async () => {
      vi.useFakeTimers({ now: START });
      try {
        const onMissing = vi.fn();
        const link = vi.fn(async () => {
          throw new LinkRefused("busy", Date.now() + 1_000);
        });
        const done = cardsFor(wantedOf("Dune https://img.test/dune.jpg", 100), vi.fn(), vi.fn(), {
          link,
          onMissing,
        });
        await vi.advanceTimersByTimeAsync(BUSY_TRIES * 1_000);
        await done;
        expect(link).toHaveBeenCalledTimes(BUSY_TRIES);
        expect(onMissing).toHaveBeenCalledWith("Dune", "busy");
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks nothing more once the box is gone", async () => {
      vi.useFakeTimers({ now: START });
      try {
        let open = true;
        const onCard = vi.fn();
        const link = vi.fn(async () => {
          throw new LinkRefused("busy", START + 5_000);
        });
        const done = cardsFor(wantedOf("Dune https://img.test/dune.jpg", 100), vi.fn(), onCard, {
          link,
          going: () => open,
        });
        await vi.advanceTimersByTimeAsync(0);
        open = false;
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(done).resolves.toBeNull();
        expect(link).toHaveBeenCalledTimes(1);
        expect(onCard).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps no more than three lines asking at once while one waits", async () => {
      vi.useFakeTimers({ now: START });
      try {
        let asking = 0;
        let most = 0;
        let first = true;
        const link = vi.fn(async (ask: LinkAsk) => {
          asking++;
          most = Math.max(most, asking);
          await Promise.resolve();
          asking--;
          if (first) {
            first = false;
            throw new LinkRefused("busy", START + 2_000);
          }
          return linked(ask.url);
        });
        const got: PastedCard[] = [];
        const done = cardsFor(
          wantedOf([1, 2, 3, 4, 5].map((n) => `${n} https://img.test/${n}.jpg`).join("\n"), 100),
          vi.fn(),
          (one) => got.push(one),
          { link },
        );
        await vi.advanceTimersByTimeAsync(2_000);
        await done;
        expect(most).toBeLessThanOrEqual(3);
        expect(got.map((one) => one.title)).toEqual(["1", "2", "3", "4", "5"]);
        expect(got.every((one) => one.imageUrl !== null)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("cardsFor, with a busy catalogue", () => {
  const START = 1_000_000;
  const dish = card("wikidata:Q177", "pizza", "Italian dish");
  const film = card("tmdb:9", "Pizza", "2012");
  const busyFailure = (retryAt?: number, busy: string[] = ["wikidata"]) =>
    new ApiFailure({ kind: "sourceBusy", busy, ...(retryAt === undefined ? {} : { retryAt }) });

  it("waits for the catalogues of a section, Wikidata elsewhere, and none for a list about nothing", () => {
    const anime = waitsForIn("anime");
    expect(anime("anilist")).toBe(true);
    expect(anime("wikidata")).toBe(false);
    expect(anime("web")).toBe(false);
    const food = waitsForIn("food");
    expect(food("wikidata")).toBe(true);
    expect(food("tmdb")).toBe(false);
    expect(waitsForIn(null)("wikidata")).toBe(false);
    expect(waitsForIn(null)("tmdb")).toBe(false);
  });

  it("gives up a wait asked often enough, or too far off", () => {
    expect(busyUntil(START + 5_000, 1, START)).toBe(START + 5_000);
    expect(busyUntil(undefined, 1, START)).toBe(START + BUSY_FALLBACK_MS);
    expect(busyUntil(null, 1, START)).toBe(START + BUSY_FALLBACK_MS);
    expect(busyUntil(START + BUSY_WAIT_MAX_MS, 1, START)).toBe(START + BUSY_WAIT_MAX_MS);
    expect(busyUntil(START + BUSY_WAIT_MAX_MS + 1, 1, START)).toBeNull();
    expect(busyUntil(START + 5_000, BUSY_TRIES, START)).toBeNull();
  });

  it("waits when nothing was found while a catalogue was busy, and asks the same name again", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const got: PastedCard[] = [];
      const onWaiting = vi.fn();
      const onMissing = vi.fn();
      const lookup = vi
        .fn<(query: string) => Promise<CatalogueItem[]>>()
        .mockRejectedValueOnce(busyFailure(START + 20_000))
        .mockResolvedValue([dish]);
      const done = cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
        preferred: "wikidata",
        paceMs: 0,
        onWaiting,
        onMissing,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onWaiting).toHaveBeenLastCalledWith(START + 20_000);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(lookup).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(lookup.mock.calls).toEqual([["Pizza"], ["Pizza"]]);
      expect(onWaiting.mock.calls).toEqual([[START + 20_000], [null]]);
      expect(onMissing).not.toHaveBeenCalled();
      expect(got).toEqual([
        { title: "Pizza", imageUrl: "https://img/wikidata:Q177.jpg", key: "wikidata:Q177" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a busy catalogue even where any card would do", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const naruto = card("anilist:20", "Naruto", "2002");
      const lookup = vi
        .fn<(query: string) => Promise<CatalogueItem[]>>()
        .mockRejectedValueOnce(busyFailure(undefined, ["anilist"]))
        .mockResolvedValue([naruto]);
      const got: PastedCard[] = [];
      const done = cardsFor(wantedOf("Naruto", 100), lookup, (one) => got.push(one), {
        paceMs: 0,
      });
      await vi.advanceTimersByTimeAsync(BUSY_FALLBACK_MS);
      await done;
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(got).toEqual([
        { title: "Naruto", imageUrl: "https://img/anilist:20.jpg", key: "anilist:20" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the name alone, saying the site stayed busy, after a few tries", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const onMissing = vi.fn();
      const got: PastedCard[] = [];
      const lookup = vi.fn(async () => {
        throw busyFailure(Date.now() + 1_000);
      });
      const done = cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
        preferred: "wikidata",
        paceMs: 0,
        onMissing,
      });
      await vi.advanceTimersByTimeAsync(BUSY_TRIES * 1_000);
      await expect(done).resolves.toBeNull();
      expect(lookup).toHaveBeenCalledTimes(BUSY_TRIES);
      expect(got).toEqual([{ title: "Pizza", imageUrl: null }]);
      expect(onMissing).toHaveBeenCalledWith("Pizza", "busy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for a time too far off", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const onMissing = vi.fn();
      const onWaiting = vi.fn();
      const lookup = vi.fn(async () => {
        throw busyFailure(START + BUSY_WAIT_MAX_MS + 1);
      });
      await cardsFor(wantedOf("Pizza", 100), lookup, vi.fn(), {
        paceMs: 0,
        onMissing,
        onWaiting,
      });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(onWaiting).not.toHaveBeenCalled();
      expect(onMissing).toHaveBeenCalledWith("Pizza", "busy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a name as unanswered when the searches run out while it waits", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const onMissing = vi.fn();
      const lookup = vi
        .fn<(query: string) => Promise<CatalogueItem[]>>()
        .mockRejectedValueOnce(busyFailure(START + 1_000))
        .mockRejectedValue(new ApiFailure({ kind: "searchLimit", retryAt: 1_794_571_200_000 }));
      const done = cardsFor(wantedOf("Pizza", 100), lookup, vi.fn(), { paceMs: 0, onMissing });
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(done).resolves.toEqual({ unanswered: 1, retryAt: 1_794_571_200_000 });
      expect(onMissing).toHaveBeenCalledWith("Pizza", "searchLimit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the catalogue whose card the name takes, and takes it once it answers", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const onWaiting = vi.fn();
      const lookup = vi
        .fn<(query: string) => Promise<LookedUp>>()
        .mockResolvedValueOnce({ items: [film], busy: ["wikidata"], retryAt: START + 5_000 })
        .mockResolvedValue({ items: [film, dish] });
      const got: PastedCard[] = [];
      const done = cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
        preferred: "wikidata",
        waitFor: waitsForIn("food"),
        paceMs: 0,
        onWaiting,
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(lookup).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(onWaiting.mock.calls).toEqual([[START + 5_000], [null]]);
      // The film's poster was not taken for the dish while Wikidata rested.
      expect(got).toEqual([
        { title: "Pizza", imageUrl: "https://img/wikidata:Q177.jpg", key: "wikidata:Q177" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes what was found once its own catalogue has been waited for long enough", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const other = card("wikidata:Q1", "Naruto", "manga series");
      const lookup = vi.fn(async (): Promise<LookedUp> => ({
        items: [other],
        busy: ["anilist"],
        retryAt: Date.now() + 1_000,
      }));
      const onMissing = vi.fn();
      const got: PastedCard[] = [];
      const done = cardsFor(wantedOf("Naruto", 100), lookup, (one) => got.push(one), {
        waitFor: waitsForIn("anime"),
        paceMs: 0,
        onMissing,
      });
      await vi.advanceTimersByTimeAsync(BUSY_TRIES * 1_000);
      await done;
      expect(lookup).toHaveBeenCalledTimes(BUSY_TRIES);
      expect(got).toEqual([
        { title: "Naruto", imageUrl: "https://img/wikidata:Q1.jpg", key: "wikidata:Q1" },
      ]);
      expect(onMissing).not.toHaveBeenCalled();

      // Where only Wikidata's card would do and it never answered, the name goes alone.
      lookup.mockClear();
      got.length = 0;
      lookup.mockImplementation(async () => ({
        items: [film],
        busy: ["wikidata"],
        retryAt: START + BUSY_WAIT_MAX_MS * 10,
      }));
      await cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
        preferred: "wikidata",
        waitFor: waitsForIn("food"),
        paceMs: 0,
        onMissing,
      });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(got).toEqual([{ title: "Pizza", imageUrl: null }]);
      expect(onMissing).toHaveBeenCalledWith("Pizza", "busy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for a busy catalogue whose card the name would not take", async () => {
    const lookup = vi.fn(async (): Promise<LookedUp> => ({
      items: [film, dish],
      busy: ["tmdb"],
      retryAt: Date.now() + 5_000,
    }));
    const onWaiting = vi.fn();
    const got: PastedCard[] = [];
    await cardsFor(wantedOf("Pizza", 100), lookup, (one) => got.push(one), {
      preferred: "wikidata",
      waitFor: waitsForIn("food"),
      paceMs: 0,
      onWaiting,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(onWaiting).not.toHaveBeenCalled();
    expect(got).toEqual([
      { title: "Pizza", imageUrl: "https://img/wikidata:Q177.jpg", key: "wikidata:Q177" },
    ]);
  });

  it("waits for Wikidata on a line that gives the subject's id", async () => {
    vi.useFakeTimers({ now: START });
    try {
      const band = card("wikidata:Q22151", "Muse", "English rock band");
      const lookup = vi
        .fn<(query: string) => Promise<LookedUp>>()
        .mockResolvedValueOnce({ items: [], busy: ["wikidata"], retryAt: START + 1_000 })
        .mockResolvedValue({ items: [band] });
      const got: PastedCard[] = [];
      // A section with catalogues of its own, which would not wait for Wikidata otherwise.
      const done = cardsFor(wantedOf("Muse (Q22151)", 100), lookup, (one) => got.push(one), {
        waitFor: waitsForIn("music"),
        paceMs: 0,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(lookup.mock.calls).toEqual([["Q22151"], ["Q22151"]]);
      expect(got).toEqual([
        { title: "Muse", imageUrl: "https://img/wikidata:Q22151.jpg", key: "wikidata:Q22151" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
