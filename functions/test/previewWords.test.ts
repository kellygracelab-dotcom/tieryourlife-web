import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  offeredLocales,
  PREVIEW_LOCALES,
  previewLocale,
  say,
  translatorFor,
  wordsFor,
} from "../src/previewWords";

describe("previewLocale", () => {
  const offered = ["ru", "pt-BR"];

  it("takes the reader's first language the list is offered in", () => {
    assert.equal(previewLocale(undefined, "de-DE,ru;q=0.8,en;q=0.5", offered), "ru");
    assert.equal(previewLocale(undefined, "en;q=0.4,ru;q=0.9", offered), "ru");
    assert.equal(previewLocale(undefined, "pt-PT,pt;q=0.9", offered), "pt-BR");
  });

  it("stays as written for English, for a language the list lacks, and for no language", () => {
    assert.equal(previewLocale(undefined, "en-US,ru;q=0.9", offered), "en");
    assert.equal(previewLocale(undefined, "de-DE", offered), "en");
    assert.equal(previewLocale(undefined, undefined, offered), "en");
    assert.equal(previewLocale(undefined, "*", offered), "en");
    assert.equal(previewLocale(undefined, "ru;q=0", offered), "en");
  });

  it("puts the address's language first", () => {
    assert.equal(previewLocale("ru", "en", offered), "ru");
    assert.equal(previewLocale(["ru"], "en", offered), "en");
  });
});

describe("offeredLocales and translatorFor", () => {
  const translations = {
    ru: { "Best films": "Лучшие фильмы", Alien: "Чужой" },
    de: { "Best films": "  " },
    xx: { "Best films": "?" },
    fr: "not words",
  };

  it("offers the site's languages a house list has words or a title in", () => {
    assert.deepEqual(offeredLocales(translations, { uk: "Найкращі фільми" }), ["ru", "uk"]);
    assert.deepEqual(offeredLocales(undefined, null), []);
  });

  it("reads a list's words as the site does: translated where it can, as written elsewhere", () => {
    const ru = translatorFor(translations, { ru: "Кино" }, "ru");
    assert.equal(ru.title("Best films"), "Кино");
    assert.equal(ru.word("Alien"), "Чужой");
    assert.equal(ru.word("Arrival"), "Arrival");
    const de = translatorFor(translations, undefined, "de");
    assert.equal(de.title("Best films"), "Best films");
  });
});

describe("say", () => {
  it("picks the language's plural form and writes its numbers", () => {
    assert.equal(say("ru", wordsFor("ru").cards, 1), "1 карточка");
    assert.equal(say("ru", wordsFor("ru").cards, 3), "3 карточки");
    assert.equal(say("ru", wordsFor("ru").cards, 11), "11 карточек");
    assert.equal(say("en", wordsFor("en").cards, 1200), "1,200 cards");
    assert.equal(
      say("de", wordsFor("de").rankedHead, 5, { placed: 2 }),
      wordsFor("de").rankedHead.other.replace("{placed}", "2").replace("{n}", "5"),
    );
  });

  it("has every word in every language the site speaks", () => {
    assert.equal(PREVIEW_LOCALES.length, 11);
    for (const locale of PREVIEW_LOCALES) {
      const words = wordsFor(locale);
      for (const n of [0, 1, 2, 3, 5, 11, 21, 100]) {
        for (const plural of [
          words.toRank,
          words.visitorRanked,
          words.cards,
          words.rankedHead,
          words.moreTiers,
        ]) {
          const said = say(locale, plural, n, { placed: 1 });
          assert.ok(!said.includes("{"), `${locale} ${n}: ${said}`);
        }
      }
      assert.ok(words.untitled.trim() !== "", locale);
      assert.match(words.ogLocale, /^[a-z]{2}_[A-Z]{2}$/, locale);
    }
  });
});
