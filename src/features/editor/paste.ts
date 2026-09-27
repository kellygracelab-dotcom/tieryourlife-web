import type { CatalogueItem } from "../../api/catalogue";
import type { Category } from "../../api/types";

/** A name somebody pasted, and what they put in brackets after it, if anything. */
export interface Wanted {
  title: string;
  year: string | null;
  /** The catalogue's own id of the subject, when the line gives it: nothing is guessed then. */
  id?: string;
}

/** What people paste comes out of numbered and bulleted lists as often as not. */
const MARKER = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const WITH_YEAR = /^(.*\S)\s*\((\d{4})\)$/;
/** Wikidata's number of a subject, the way its own pages write it. */
const WITH_NUMBER = /^(.*\S)\s*\((Q\d+)\)$/;

/**
 * The names in a pasted text, one to a line, each once, in the order they
 * came. A year in brackets is taken off the name and kept beside it: it tells
 * two films of one name apart. Wikidata's number in brackets names the subject
 * itself: "Orange (Q13191)" is the fruit, not the town or the colour.
 */
export function wantedOf(text: string, limit: number): Wanted[] {
  const seen = new Set<string>();
  const wanted: Wanted[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (wanted.length >= limit) break;
    const name = line.replace(MARKER, "").trim();
    if (name.length === 0) continue;
    const numbered = WITH_NUMBER.exec(name);
    const dated = numbered === null ? WITH_YEAR.exec(name) : null;
    const title = (numbered?.[1] ?? dated?.[1] ?? name).trim();
    const year = dated?.[2] ?? null;
    const number = numbered?.[2] ?? null;
    const key = `${title.toLowerCase()}|${year ?? ""}|${number ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(number === null ? { title, year } : { title, year, id: `wikidata:${number}` });
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

const from =
  (catalogue: "tmdb" | "wikidata") =>
  (item: CatalogueItem): boolean =>
    item.id.startsWith(`${catalogue}:`);

/**
 * The catalogue's card for a pasted name, or none. Only a card of exactly
 * that name is taken: a near miss would put the wrong poster on a card, and a
 * card with its name alone is the better mistake. With a year, only a card
 * that carries it. Of several, the first from the preferred catalogue, and
 * the first of all when that one knows nothing by the name.
 *
 * TMDB knows films, series and people only. Where the list is about something
 * else and nothing of Wikidata's came at all, Wikidata did not answer, and a
 * film's poster in its place would be a guess: the name goes alone.
 *
 * A line that gives the subject's id gets that subject or nothing, whatever
 * the catalogue calls it: "Football (Q2736)" is the game Wikidata knows as
 * association football.
 */
export function pick(
  wanted: Wanted,
  found: readonly CatalogueItem[],
  preferred: Preferred = null,
): CatalogueItem | null {
  if (wanted.id !== undefined) return found.find((item) => item.id === wanted.id) ?? null;
  const name = wanted.title.toLowerCase();
  const year = wanted.year;
  const named = found.filter(
    (item) =>
      item.title.trim().toLowerCase() === name &&
      (year === null || item.subtitle?.includes(year) === true),
  );
  if (preferred === null) return named[0] ?? null;
  const own = named.find(from(preferred));
  if (own !== undefined) return own;
  if (preferred === "wikidata" && !found.some(from("wikidata"))) return null;
  return named[0] ?? null;
}

/** How many of the catalogue's answers are waited for at once. */
export const PASTE_AT_ONCE = 3;

/**
 * A few names take this long at least, however soon the answers come.
 * Wikidata answers a page two hundred times a minute and refuses after that;
 * a long list asked at full speed would get past it and lose its pictures.
 */
export const PASTE_PACE_MS = 1000;

export interface PasteOptions {
  /** False once the box is gone: nothing more is asked, nothing handed over. */
  going?: () => boolean;
  preferred?: Preferred;
  paceMs?: number;
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
  { going = () => true, preferred = null, paceMs = PASTE_PACE_MS }: PasteOptions = {},
): Promise<void> {
  const ask = (one: Wanted): Promise<CatalogueItem[]> =>
    lookup(one.title).catch((): CatalogueItem[] => []);
  // A catalogue that is busy says nothing, the same as one that knows nothing.
  // The one this name is for gets a second question before the name goes alone.
  const answerFor = async (one: Wanted): Promise<CatalogueItem[]> => {
    const needed = one.id === undefined ? preferred : "wikidata";
    const first = await ask(one);
    if (needed === null ? first.length > 0 : first.some(from(needed))) return first;
    if (paceMs > 0) await pause(paceMs);
    if (!going()) return first;
    const second = await ask(one);
    return second.length > 0 ? second : first;
  };

  for (let start = 0; start < wanted.length; start += PASTE_AT_ONCE) {
    const few = wanted.slice(start, start + PASTE_AT_ONCE);
    const last = start + PASTE_AT_ONCE >= wanted.length;
    const [answers] = await Promise.all([
      Promise.all(few.map(answerFor)),
      // Nothing is asked after the last few, so nothing is waited for.
      last || paceMs <= 0 ? undefined : pause(paceMs),
    ]);
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
