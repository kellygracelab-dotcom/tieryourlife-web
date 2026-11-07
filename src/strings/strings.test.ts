import { afterEach, describe, expect, it } from "vitest";
import { LOCALES } from "../lib/locale";
import { en } from "./en";
import {
  availableLocales,
  currentLocale,
  fill,
  formatCount,
  loadStrings,
  overlay,
  plural,
  setStrings,
  strings,
  type Translation,
} from "./index";

// The language in use is module state; a test that changes it puts English back.
afterEach(() => setStrings("en", null));

describe("strings", () => {
  it("fills named holes and leaves unknown ones visible", () => {
    expect(fill("by {name}", { name: "danylo" })).toBe("by danylo");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    // Numbers in the page's own way of writing them, strings as they are.
    expect(fill("{n} of {total}", { n: 1234, total: 5000 })).toBe("1,234 of 5,000");
    expect(fill("keys {keys}", { keys: "1–9" })).toBe("keys 1–9");
  });

  it("picks the plural form and groups thousands", () => {
    expect(plural(strings.card.items, 1)).toBe("1 card");
    expect(plural(strings.card.items, 0)).toBe("0 cards");
    expect(plural(strings.card.rankings, 2140)).toBe("2,140 rankings");
    expect(formatCount(1000000)).toBe("1,000,000");
  });

  it("keeps the attribution TMDB requires word for word", () => {
    expect(strings.about.tmdb).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
  });
});

describe("another language", () => {
  const russianCards: Translation = {
    card: {
      items: {
        one: "{n} карточка",
        few: "{n} карточки",
        many: "{n} карточек",
        other: "{n} карточки",
      },
    },
  };

  it("counts by its own rules: Russian has a form for 2–4 and another for 5–20", () => {
    setStrings("ru", russianCards);
    expect(currentLocale()).toBe("ru");
    expect(plural(strings.card.items, 1)).toBe("1 карточка");
    expect(plural(strings.card.items, 3)).toBe("3 карточки");
    expect(plural(strings.card.items, 5)).toBe("5 карточек");
    expect(plural(strings.card.items, 21)).toBe("21 карточка");
    expect(plural(strings.card.items, 112)).toBe("112 карточек");
    // Numbers are grouped the way the language groups them, not with English commas.
    expect(formatCount(1000000)).not.toBe("1,000,000");
  });

  it("falls back to `other` for a form a dictionary does not carry", () => {
    setStrings("ru", { card: { items: { other: "{n} шт." } } });
    expect(plural(strings.card.items, 1)).toBe("1 шт.");
    expect(plural(strings.card.items, 5)).toBe("5 шт.");
  });

  it("reads from English whatever a translation has not reached yet", () => {
    setStrings("uk", { nav: { signIn: "Увійти" } });
    expect(strings.nav.signIn).toBe("Увійти");
    expect(strings.nav.signOut).toBe("Sign out");
    expect(strings.about.tmdb).toBe(en.about.tmdb);
    expect(plural(strings.card.items, 2)).toBe("2 cards");
  });

  // The categories of a list have an "Other" of their own. Taking any object
  // with an `other` for plural forms swallowed the whole group.
  it("does not mistake the categories, which have an Other, for plural forms", () => {
    const merged = overlay(en, { category: { anime: "Аніме" } });
    expect(merged.category.anime).toBe("Аніме");
    expect(merged.category.other).toBe(en.category.other);
    expect(merged.category.games).toBe(en.category.games);

    // And a translated Other stays a category, one text among nine.
    setStrings("uk", { category: { other: "Інше" } });
    expect(strings.category.other).toBe("Інше");
    expect(strings.category.anime).toBe("Anime");
  });

  // The type of a dictionary had the same flaw after the merge was mended, and
  // no test saw it: `{ other }` alone passes for plural forms. A category named
  // beside Other is what a real dictionary writes, and what did not compile.
  it("lets a dictionary name the categories, and still takes four forms for a count", () => {
    const dictionary: Translation = {
      category: { anime: "Аниме", other: "Другое" },
      card: {
        items: {
          one: "{n} карточка",
          few: "{n} карточки",
          many: "{n} карточек",
          other: "{n} карточки",
        },
      },
    };
    setStrings("ru", dictionary);
    expect(strings.category.anime).toBe("Аниме");
    expect(strings.category.other).toBe("Другое");
    expect(strings.category.games).toBe("Games");
    expect(plural(strings.card.items, 3)).toBe("3 карточки");
  });

  it("ignores what is not text where text is due, and keys English does not have", () => {
    const merged = overlay(en, { brand: 5, nav: "no", stranger: { a: "b" } });
    expect(merged.brand).toBe(en.brand);
    expect(merged.nav).toEqual(en.nav);
    expect("stranger" in merged).toBe(false);
  });

  it("stays in English for a language that has no dictionary yet", async () => {
    const missing = LOCALES.find((locale) => !availableLocales().includes(locale));
    if (missing === undefined) return;
    await loadStrings(missing);
    expect(currentLocale()).toBe("en");
    expect(strings.nav.signIn).toBe("Sign in");
  });
});

// Every dictionary there is, today and later: nothing English lacks, and the
// same holes in every text, so a {name} cannot be translated away.
describe("the dictionaries", () => {
  const files = import.meta.glob<{ default: Translation }>("./locales/*.ts", { eager: true });
  const holesOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  // In a plural group, a form that serves one count only may say it in the
  // word itself (Arabic's «بطاقتان», two cards) and leave the {n} out. Russian
  // and Ukrainian `one` also serves 21, 31, 41…, so there it must say the number.
  const singleCounts = (tag: string): Set<string> => {
    const rules = new Intl.PluralRules(tag);
    const counts = new Map<string, number>();
    for (let n = 1; n <= 1000; n++) {
      const category = rules.select(n);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return new Set(["zero", "one", "two"].filter((category) => (counts.get(category) ?? 0) <= 1));
  };
  const tagOf = (file: string) => file.replace(/^.*\/|\.ts$/g, "");

  const problemsOf = (
    base: unknown,
    over: unknown,
    path: string,
    single: Set<string>,
    countInWord = false,
  ): string[] => {
    if (typeof over === "string") {
      if (typeof base !== "string") return [`${path}: text where English has a group`];
      const holes = (text: string) =>
        holesOf(text).filter((hole) => !(countInWord && hole === "n"));
      const same = holes(base).join() === holes(over).join();
      return same ? [] : [`${path}: holes ${holes(over).join()} ≠ ${holes(base).join()}`];
    }
    if (typeof over !== "object" || over === null) return [`${path}: neither text nor a group`];
    if (typeof base !== "object" || base === null) return [`${path}: not in English`];
    const english = base as Record<string, unknown>;
    const isPlural = typeof english.other === "string" && typeof english.one === "string";
    return Object.entries(over).flatMap(([key, value]) => {
      // A plural form English lacks (few, many…) is compared with English's `other`.
      // So is a form that serves more than one count, whatever English's `one` says.
      const against = isPlural
        ? single.has(key)
          ? (english[key] ?? english.other)
          : english.other
        : english[key];
      return against === undefined
        ? [`${path}.${key}: not in English`]
        : problemsOf(against, value, `${path}.${key}`, single, isPlural && single.has(key));
    });
  };

  it("offers English and only the languages that have a file, in the phone app's order", () => {
    expect(availableLocales()[0]).toBe("en");
    expect(availableLocales()).toHaveLength(1 + Object.keys(files).length);
    // The files come off the disk as ru, uk; the app's picker says Ukrainian first.
    const offered = availableLocales();
    expect(offered).toEqual(LOCALES.filter((locale) => offered.includes(locale)));
    expect(offered.indexOf("uk")).toBeLessThan(offered.indexOf("ru"));
  });

  it("carry nothing English lacks, and keep every hole of every text", () => {
    for (const [file, module] of Object.entries(files)) {
      expect(problemsOf(en, module.default, file, singleCounts(tagOf(file)))).toEqual([]);
    }
  });

  // What a dictionary may leave in English: the brand, two counters made of
  // digits, and TMDB's logo text and sentence, which TMDB's terms fix.
  const LEFT_IN_ENGLISH = new Set([
    "brand",
    "settings.nameCounter",
    "report.noteCounter",
    "about.tmdbLogo",
    "about.tmdb",
  ]);

  // Every text English has. Which plural forms a group spells out is the
  // translator's call: a form left out reads as `other`, and Russian says
  // «{n} добавлено» whatever the count.
  const gapsOf = (base: unknown, over: unknown, path: string): string[] => {
    if (typeof base === "string") {
      return typeof over === "string" || LEFT_IN_ENGLISH.has(path) ? [] : [path];
    }
    const english = base as Record<string, unknown>;
    const given = (typeof over === "object" && over !== null ? over : {}) as Record<
      string,
      unknown
    >;
    if (typeof english.other === "string" && typeof english.one === "string") {
      return typeof given.other === "string" ? [] : [path];
    }
    return Object.entries(english).flatMap(([key, value]) =>
      gapsOf(value, given[key], path === "" ? key : `${path}.${key}`),
    );
  };

  it("translate every text", () => {
    for (const [file, module] of Object.entries(files)) {
      expect(gapsOf(en, module.default, ""), file).toEqual([]);
    }
  });

  /** Every text of a dictionary, by its path. */
  const textsOf = (group: unknown, path = ""): [string, string][] =>
    typeof group === "string"
      ? [[path, group]]
      : Object.entries((group ?? {}) as Record<string, unknown>).flatMap(([key, value]) =>
          textsOf(value, path === "" ? key : `${path}.${key}`),
        );

  it("write one apostrophe per language: the typographic one, and Ukrainian's ʼ", () => {
    const wrong = (tag: string, texts: [string, string][], apostrophe: RegExp) =>
      texts.filter(([, text]) => apostrophe.test(text)).map(([path]) => `${tag}: ${path}`);
    const straight = /\p{L}'\p{L}/u;
    expect(wrong("en", textsOf(en), straight)).toEqual([]);
    for (const [file, module] of Object.entries(files)) {
      const tag = tagOf(file);
      const apostrophe = tag === "uk" ? /\p{L}['’]\p{L}/u : straight;
      expect(wrong(tag, textsOf(module.default), apostrophe)).toEqual([]);
    }
  });

  it("call a tier on the board and in its editor what the app's tier editor calls it", () => {
    // Russian and Ukrainian say тир in general text, as the app does, and уровень / рівень here.
    const board = (dictionary: Translation) =>
      textsOf({
        new: dictionary.new,
        rank: dictionary.rank,
        boards: dictionary.boards,
        // The limit is the app's own sentence, and a list's sample title is general text.
      }).filter(([path]) => !path.endsWith("tooManyTiers") && !path.endsWith("namePlaceholder"));
    for (const tag of ["ru", "uk"]) {
      const dictionary = files[`./locales/${tag}.ts`]!.default;
      expect(board(dictionary).filter(([, text]) => /(^|\P{L})тир/iu.test(text))).toEqual([]);
    }
  });

  // QA W56: the profile picture's step said "your face" where the rest of it
  // says the app's word (аватар, Profilbild, profil resmi, アイコン…).
  it("call the profile picture what the app calls it while it is placed", () => {
    // Turkish "bu yüzden" is "so", not a face.
    const face = /лиц[оа]|обличч|Gesicht|顔|yüzünüz|وجه/u;
    for (const tag of ["ar", "de", "ja", "ru", "tr", "uk"]) {
      const { settings } = files[`./locales/${tag}.ts`]!.default;
      const texts = textsOf({ settings });
      expect(
        texts.filter(([, text]) => face.test(text)).map(([path]) => `${tag}: ${path}`),
      ).toEqual([]);
    }
  });

  // QA W55: the app's words for a ranking and a report, everywhere: de
  // Rangliste, ja 通報, tr şikayet (the verb stays bildir, as in the app).
  it("call a ranking and a report what the app calls them", () => {
    const retired: [string, RegExp][] = [
      ["de", /Reihung/u],
      ["ja", /報告/u],
      ["tr", /(^|\P{L})bildirim/iu],
    ];
    for (const [tag, word] of retired) {
      const texts = textsOf(files[`./locales/${tag}.ts`]!.default);
      expect(
        texts.filter(([, text]) => word.test(text)).map(([path]) => `${tag}: ${path}`),
      ).toEqual([]);
    }
  });
});
