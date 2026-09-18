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

  const problemsOf = (base: unknown, over: unknown, path: string): string[] => {
    if (typeof over === "string") {
      if (typeof base !== "string") return [`${path}: text where English has a group`];
      const same = holesOf(base).join() === holesOf(over).join();
      return same ? [] : [`${path}: holes ${holesOf(over).join()} ≠ ${holesOf(base).join()}`];
    }
    if (typeof over !== "object" || over === null) return [`${path}: neither text nor a group`];
    if (typeof base !== "object" || base === null) return [`${path}: not in English`];
    const english = base as Record<string, unknown>;
    const plural = typeof english.other === "string" && typeof english.one === "string";
    return Object.entries(over).flatMap(([key, value]) => {
      // A plural form English lacks (few, many…) is compared with English's `other`.
      const against = plural ? (english[key] ?? english.other) : english[key];
      return against === undefined
        ? [`${path}.${key}: not in English`]
        : problemsOf(against, value, `${path}.${key}`);
    });
  };

  it("offers English and only the languages that have a file", () => {
    expect(availableLocales()[0]).toBe("en");
    expect(availableLocales()).toHaveLength(1 + Object.keys(files).length);
  });

  it("carry nothing English lacks, and keep every hole of every text", () => {
    for (const [file, module] of Object.entries(files)) {
      expect(problemsOf(en, module.default, file)).toEqual([]);
    }
  });
});
