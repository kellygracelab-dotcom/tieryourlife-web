import type { CatalogueItem } from "../../api/catalogue";
import type { Category } from "../../api/types";

/** A name somebody pasted, and the year they put in brackets after it, if any. */
export interface Wanted {
  title: string;
  year: string | null;
}

/** What people paste comes out of numbered and bulleted lists as often as not. */
const MARKER = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const WITH_YEAR = /^(.*\S)\s*\((\d{4})\)$/;

/**
 * The names in a pasted text, one to a line, each once, in the order they
 * came. A year in brackets is taken off the name and kept beside it: it tells
 * two films of one name apart.
 */
export function wantedOf(text: string, limit: number): Wanted[] {
  const seen = new Set<string>();
  const wanted: Wanted[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (wanted.length >= limit) break;
    const name = line.replace(MARKER, "").trim();
    if (name.length === 0) continue;
    const dated = WITH_YEAR.exec(name);
    const title = (dated?.[1] ?? name).trim();
    const year = dated?.[2] ?? null;
    const key = `${title.toLowerCase()}|${year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ title, year });
  }
  return wanted;
}

/** The catalogue whose card a pasted name takes first; none while the list is about nothing yet. */
export type Preferred = "tmdb" | "wikidata" | null;

/**
 * Films, series and the people in them are TMDB's, the rest is Wikidata's: a
 * list of food with "Pizza" in it wants the dish, not the poster of a film by
 * that name.
 */
export const preferredFor = (category: Category | null): Preferred => {
  if (category === null) return null;
  return category === "film_tv" || category === "anime" || category === "people"
    ? "tmdb"
    : "wikidata";
};

/**
 * The catalogue's card for a pasted name, or none. Only a card of exactly
 * that name is taken: a near miss would put the wrong poster on a card, and a
 * card with its name alone is the better mistake. With a year, only a card
 * that carries it. Of several, the first from the preferred catalogue, and
 * the first of all when that one knows nothing by the name.
 */
export function pick(
  wanted: Wanted,
  found: readonly CatalogueItem[],
  preferred: Preferred = null,
): CatalogueItem | null {
  const name = wanted.title.toLowerCase();
  const year = wanted.year;
  const named = found.filter(
    (item) =>
      item.title.trim().toLowerCase() === name &&
      (year === null || item.subtitle?.includes(year) === true),
  );
  const own =
    preferred === null ? undefined : named.find((item) => item.id.startsWith(`${preferred}:`));
  return own ?? named[0] ?? null;
}

/** How many of the catalogue's answers are waited for at once. */
export const PASTE_AT_ONCE = 3;

export interface PastedCard {
  title: string;
  imageUrl: string | null;
  key?: string;
}

/**
 * Every pasted name as a card, in the order pasted, a few at a time. A name
 * the catalogue does not answer for, or fails on, comes as its name alone.
 * The name stays the way it was written: the catalogue differs by its case
 * only, and Wikidata writes "pizza" where a card wants "Pizza".
 */
export async function cardsFor(
  wanted: readonly Wanted[],
  lookup: (query: string) => Promise<CatalogueItem[]>,
  onCard: (card: PastedCard, done: number) => void,
  going: () => boolean = () => true,
  preferred: Preferred = null,
): Promise<void> {
  for (let start = 0; start < wanted.length; start += PASTE_AT_ONCE) {
    const few = wanted.slice(start, start + PASTE_AT_ONCE);
    const answers = await Promise.all(
      few.map((one) => lookup(one.title).catch((): CatalogueItem[] => [])),
    );
    if (!going()) return;
    few.forEach((one, index) => {
      const card = pick(one, answers[index] ?? [], preferred);
      onCard(
        card === null
          ? { title: one.title, imageUrl: null }
          : { title: one.title, imageUrl: card.imageUrl, key: card.id },
        start + index + 1,
      );
    });
  }
}
