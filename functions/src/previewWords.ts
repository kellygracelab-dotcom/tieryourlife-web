/**
 * The words of a link's preview in the site's languages. A house list is
 * translated on the site, so its preview speaks the language its reader
 * asked for when the list has it; every other list, and a house list in a
 * language it lacks, previews as written, in English words. Pure: pages.ts
 * reads the documents and the request, this decides the words.
 */

type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

interface Words {
  /** The line of an editorial list: so many cards waiting to be ranked. */
  toRank: Plural;
  /** The line of a ranking of one, counted by the list's cards: `{placed}` of `{n}`. */
  visitorRanked: Plural;
  /** A list card's count of cards. */
  cards: Plural;
  /** A ranking card's line, counted by the list's cards. */
  rankedHead: Plural;
  /** Under a ranking card's rows, the tiers it had no room for. */
  moreTiers: Plural;
  untitled: string;
  /** OpenGraph's name for the language. */
  ogLocale: string;
}

/**
 * The site's words where it has them (src/strings/locales: card.items,
 * card.moreTiers, ranking.byVisitor and placedOf, untitled); the rest in
 * their style.
 */
const WORDS: Record<string, Words> = {
  en: {
    toRank: { one: "{n} item to rank", other: "{n} items to rank" },
    visitorRanked: {
      one: "A visitor ranked {placed} of {n} item",
      other: "A visitor ranked {placed} of {n} items",
    },
    cards: { one: "{n} card", other: "{n} cards" },
    rankedHead: {
      one: "ranked by a visitor · {placed} of {n} card placed",
      other: "ranked by a visitor · {placed} of {n} cards placed",
    },
    moreTiers: { one: "and {n} more tier", other: "and {n} more tiers" },
    untitled: "Untitled list",
    ogLocale: "en_US",
  },
  ar: {
    toRank: {
      zero: "لا بطاقات للترتيب",
      one: "بطاقة واحدة للترتيب",
      two: "بطاقتان للترتيب",
      few: "{n} بطاقات للترتيب",
      many: "{n} بطاقة للترتيب",
      other: "{n} بطاقة للترتيب",
    },
    visitorRanked: {
      one: "رتّب زائر {placed} من بطاقة واحدة",
      two: "رتّب زائر {placed} من بطاقتين",
      few: "رتّب زائر {placed} من {n} بطاقات",
      other: "رتّب زائر {placed} من {n} بطاقة",
    },
    cards: {
      zero: "لا بطاقات",
      one: "بطاقة واحدة",
      two: "بطاقتان",
      few: "{n} بطاقات",
      many: "{n} بطاقة",
      other: "{n} بطاقة",
    },
    rankedHead: { other: "رتّبه زائر · وُضع {placed} من {n}" },
    moreTiers: {
      zero: "ولا مستويات أخرى",
      one: "ومستوى آخر",
      two: "ومستويان آخران",
      few: "و{n} مستويات أخرى",
      many: "و{n} مستوى آخر",
      other: "و{n} مستوى آخر",
    },
    untitled: "قائمة بلا عنوان",
    ogLocale: "ar_AR",
  },
  de: {
    toRank: { one: "{n} Karte zum Einstufen", other: "{n} Karten zum Einstufen" },
    visitorRanked: {
      one: "Ein Besucher hat {placed} von {n} Karte eingestuft",
      other: "Ein Besucher hat {placed} von {n} Karten eingestuft",
    },
    cards: { one: "{n} Karte", other: "{n} Karten" },
    rankedHead: { other: "eingestuft von einem Besucher · {placed} von {n} platziert" },
    moreTiers: { one: "und {n} weitere Stufe", other: "und {n} weitere Stufen" },
    untitled: "Unbenannte Liste",
    ogLocale: "de_DE",
  },
  es: {
    toRank: { one: "{n} tarjeta para clasificar", other: "{n} tarjetas para clasificar" },
    visitorRanked: {
      one: "Un visitante clasificó {placed} de {n} tarjeta",
      other: "Un visitante clasificó {placed} de {n} tarjetas",
    },
    cards: { one: "{n} tarjeta", other: "{n} tarjetas" },
    rankedHead: { other: "clasificada por un visitante · {placed} de {n} colocadas" },
    moreTiers: { one: "y {n} nivel más", other: "y {n} niveles más" },
    untitled: "Lista sin título",
    ogLocale: "es_ES",
  },
  fr: {
    toRank: { one: "{n} carte à classer", other: "{n} cartes à classer" },
    visitorRanked: {
      one: "Un visiteur a classé {placed} carte sur {n}",
      other: "Un visiteur a classé {placed} cartes sur {n}",
    },
    cards: { one: "{n} carte", other: "{n} cartes" },
    rankedHead: { other: "classé par un visiteur · {placed} sur {n} placées" },
    moreTiers: { one: "et {n} autre rang", other: "et {n} autres rangs" },
    untitled: "Liste sans titre",
    ogLocale: "fr_FR",
  },
  ja: {
    toRank: { other: "ランク付けするカード {n} 枚" },
    visitorRanked: { other: "訪問者が {n} 枚中 {placed} 枚をランク付け" },
    cards: { other: "カード {n} 枚" },
    rankedHead: { other: "訪問者による · {n} 枚中 {placed} 枚を配置" },
    moreTiers: { other: "ほか{n}個のティア" },
    untitled: "無題のリスト",
    ogLocale: "ja_JP",
  },
  pl: {
    toRank: {
      one: "{n} karta do ułożenia",
      few: "{n} karty do ułożenia",
      many: "{n} kart do ułożenia",
      other: "{n} karty do ułożenia",
    },
    visitorRanked: {
      one: "Odwiedzający ocenił {placed} z {n} karty",
      few: "Odwiedzający ocenił {placed} z {n} kart",
      many: "Odwiedzający ocenił {placed} z {n} kart",
      other: "Odwiedzający ocenił {placed} z {n} karty",
    },
    cards: { one: "{n} karta", few: "{n} karty", many: "{n} kart", other: "{n} karty" },
    rankedHead: { other: "ocenione przez odwiedzającego · Umieszczono {placed} z {n}" },
    moreTiers: {
      one: "i jeszcze {n} poziom",
      few: "i jeszcze {n} poziomy",
      many: "i jeszcze {n} poziomów",
      other: "i jeszcze {n} poziomu",
    },
    untitled: "Lista bez tytułu",
    ogLocale: "pl_PL",
  },
  "pt-BR": {
    toRank: { one: "{n} card para classificar", other: "{n} cards para classificar" },
    visitorRanked: {
      one: "Um visitante classificou {placed} de {n} card",
      other: "Um visitante classificou {placed} de {n} cards",
    },
    cards: { one: "{n} card", other: "{n} cards" },
    rankedHead: { other: "classificada por um visitante · {placed} de {n} colocados" },
    moreTiers: { one: "e mais {n} nível", other: "e mais {n} níveis" },
    untitled: "Lista sem título",
    ogLocale: "pt_BR",
  },
  ru: {
    toRank: {
      one: "{n} карточка, чтобы разложить",
      few: "{n} карточки, чтобы разложить",
      many: "{n} карточек, чтобы разложить",
      other: "{n} карточки, чтобы разложить",
    },
    visitorRanked: {
      one: "Посетитель разложил {placed} из {n} карточки",
      few: "Посетитель разложил {placed} из {n} карточек",
      many: "Посетитель разложил {placed} из {n} карточек",
      other: "Посетитель разложил {placed} из {n} карточки",
    },
    cards: {
      one: "{n} карточка",
      few: "{n} карточки",
      many: "{n} карточек",
      other: "{n} карточки",
    },
    rankedHead: { other: "разложил посетитель · Разложено {placed} из {n}" },
    moreTiers: {
      one: "и ещё {n} уровень",
      few: "и ещё {n} уровня",
      many: "и ещё {n} уровней",
      other: "и ещё {n} уровня",
    },
    untitled: "Список без названия",
    ogLocale: "ru_RU",
  },
  tr: {
    toRank: { other: "Sıralanacak {n} kart" },
    visitorRanked: { other: "Bir ziyaretçi {n} karttan {placed} tanesini sıraladı" },
    cards: { other: "{n} kart" },
    rankedHead: { other: "bir ziyaretçi sıraladı · {placed} / {n} yerleştirildi" },
    moreTiers: { other: "ve {n} seviye daha" },
    untitled: "Başlıksız liste",
    ogLocale: "tr_TR",
  },
  uk: {
    toRank: {
      one: "{n} картка, щоб розкласти",
      few: "{n} картки, щоб розкласти",
      many: "{n} карток, щоб розкласти",
      other: "{n} картки, щоб розкласти",
    },
    visitorRanked: {
      one: "Відвідувач розклав {placed} із {n} картки",
      few: "Відвідувач розклав {placed} із {n} карток",
      many: "Відвідувач розклав {placed} із {n} карток",
      other: "Відвідувач розклав {placed} із {n} картки",
    },
    cards: { one: "{n} картка", few: "{n} картки", many: "{n} карток", other: "{n} картки" },
    rankedHead: { other: "розклав відвідувач · Розкладено {placed} із {n}" },
    moreTiers: {
      one: "і ще {n} рівень",
      few: "і ще {n} рівні",
      many: "і ще {n} рівнів",
      other: "і ще {n} рівня",
    },
    untitled: "Список без назви",
    ogLocale: "uk_UA",
  },
};

/** The language a list is written in: the house writes its lists in English. */
export const AS_WRITTEN = "en";

export const PREVIEW_LOCALES: readonly string[] = Object.keys(WORDS);

export const wordsFor = (locale: string): Words => WORDS[locale] ?? (WORDS.en as Words);

/** One of a plural's forms for [n], with [n] and any other value filled in. */
export function say(
  locale: string,
  plural: Plural,
  n: number,
  values: Record<string, number> = {},
): string {
  const form = plural[new Intl.PluralRules(locale).select(n)] ?? plural.other;
  const number = new Intl.NumberFormat(locale);
  return Object.entries({ ...values, n }).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(number.format(value)),
    form,
  );
}

/** One of the site's locales a tag names, `pt` and `pt-PT` the Brazilian one; null for none. */
function localeOf(tag: string): string | null {
  const clean = tag.trim().toLowerCase();
  const exact = PREVIEW_LOCALES.find((locale) => locale.toLowerCase() === clean);
  if (exact !== undefined) return exact;
  const language = clean.split("-")[0];
  return PREVIEW_LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === language) ?? null;
}

/** An Accept-Language header's languages, most wanted first. */
function wantedOf(header: string): string[] {
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((one) => one.tag !== "" && one.tag !== "*" && one.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((one) => one.tag);
}

/**
 * The language a preview speaks: the one asked for in the address (`hl`),
 * else the first of the reader's languages, among those the list is offered
 * in; else as written. A chat that sends no language gets the list as written.
 */
export function previewLocale(
  asked: unknown,
  acceptLanguage: string | undefined,
  offered: readonly string[],
): string {
  const wanted = [...(typeof asked === "string" ? [asked] : []), ...wantedOf(acceptLanguage ?? "")];
  for (const tag of wanted) {
    const locale = localeOf(tag);
    if (locale === AS_WRITTEN) return AS_WRITTEN;
    if (locale !== null && offered.includes(locale)) return locale;
  }
  return AS_WRITTEN;
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** The site's languages a house list has words or a title in. */
export function offeredLocales(translations: unknown, names: unknown): string[] {
  return PREVIEW_LOCALES.filter(
    (locale) =>
      locale !== AS_WRITTEN &&
      ((isMap(translations) &&
        isMap(translations[locale]) &&
        Object.values(translations[locale]).some((word) => textOf(word) !== null)) ||
        (isMap(names) && textOf(names[locale]) !== null)),
  );
}

export interface Translator {
  title: (title: string) => string;
  word: (text: string) => string;
}

/**
 * A house list's words in [locale], as the site's listIn (src/lib/translated.ts)
 * gives them: each text by its translation where it has one, as written where
 * it has none.
 */
export function translatorFor(translations: unknown, names: unknown, locale: string): Translator {
  const words = isMap(translations) ? translations[locale] : undefined;
  const word = (text: string): string => (isMap(words) ? textOf(words[text]) : null) ?? text;
  const name = isMap(names) ? textOf(names[locale]) : null;
  return { title: (title) => name ?? word(title), word };
}
