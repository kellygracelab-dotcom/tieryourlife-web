import { errorOf } from "../../api/errors";
import type { LinkQuota } from "../../api/linkQuota";
import type { PictureAttribution } from "../../api/pictureAttribution";
import { scopeFor, type LinkAsk } from "../../api/pictures";
import type { CatalogueItem } from "../../api/types";
import { busyUntil } from "../../lib/busyWait";
import {
  isLink,
  LinkRefused,
  linkRefusalOf,
  pageLinkOf,
  type LinkedPicture,
  type LinkFailure,
} from "../../lib/linkPictures";
import { isSearchLimit, searchLimitOf } from "../../lib/searchLimit";

/** A name somebody pasted, and what they put in brackets after it, if anything. */
export interface Wanted {
  title: string;
  year: string | null;
  /** The catalogue's own id of the subject, when the line gives it: nothing is guessed then. */
  id?: string;
  /** The picture's own address, when the line gives one after the name: no catalogue is asked. */
  picture?: string;
  /** The page the picture is from, when the line gives a second address. */
  page?: string;
}

/** What people paste comes out of numbered and bulleted lists as often as not. */
const MARKER = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const WITH_YEAR = /^(.*\S)\s*\((\d{4})\)$/;
/** Wikidata's number of a subject, the way its own pages write it. */
const WITH_NUMBER = /^(.*\S)\s*\((Q\d+)\)$/;
/** One or two addresses at a line's end: the picture's, then its page's. */
const WITH_LINKS = /(?:^|\s)(https?:\/\/\S+)(?:\s+(https?:\/\/\S+))?\s*$/i;

/** A pasted line, its parts apart: the name, and the addresses after it, as written. */
interface Line {
  name: string;
  picture: string | null;
  page: string | null;
}

/**
 * A line as its parts. Everybody writes a name, then the picture's address,
 * then the page's, with spaces between. The house writes «Name | picture link
 * | page it's from»; a line of the house's may also be written the first way.
 */
function partsOf(line: string, house: boolean): Line | null {
  const text = line.replace(MARKER, "").trim();
  if (text.length === 0) return null;
  if (house && text.includes("|")) {
    const [name = "", picture = "", page = ""] = text.split("|").map((part) => part.trim());
    return {
      name,
      picture: isLink(picture) ? picture : null,
      page: page === "" ? null : page,
    };
  }
  const links = WITH_LINKS.exec(text);
  if (links === null || !isLink(links[1] ?? "")) return { name: text, picture: null, page: null };
  return {
    name: text.slice(0, links.index).trim(),
    picture: links[1] ?? null,
    page: links[2] ?? null,
  };
}

/**
 * The names in a pasted text, one to a line, each once, in the order they
 * came. A year in brackets is taken off the name and kept beside it: it tells
 * two films of one name apart. Wikidata's number in brackets names the subject
 * itself: "Orange (Q13191)" is the fruit, not the town or the colour.
 *
 * A picture's address after the name gives the card that picture, and a
 * second address the page it is from; a page the backend would not keep
 * (https, at most 500 characters) is left out.
 */
export function wantedOf(text: string, limit: number, house = false): Wanted[] {
  const seen = new Set<string>();
  const wanted: Wanted[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (wanted.length >= limit) break;
    const parts = partsOf(line, house);
    if (parts === null || (parts.name.length === 0 && parts.picture === null)) continue;
    const name = parts.name;
    const numbered = WITH_NUMBER.exec(name);
    const dated = numbered === null ? WITH_YEAR.exec(name) : null;
    const title = (numbered?.[1] ?? dated?.[1] ?? name).trim();
    const year = dated?.[2] ?? null;
    const number = numbered?.[2] ?? null;
    const picture = parts.picture;
    const page = parts.page === null ? null : pageLinkOf(parts.page);
    const key = `${title.toLowerCase()}|${year ?? ""}|${number ?? ""}|${picture ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({
      title,
      year,
      ...(number === null ? {} : { id: `wikidata:${number}` }),
      ...(picture === null ? {} : { picture }),
      ...(picture === null || page === null ? {} : { page }),
    });
  }
  return wanted;
}

/** How many of the cards wanted look in the catalogue, and how many bring their own picture. */
export function sourcesCount(wanted: readonly Wanted[]): { catalogue: number; links: number } {
  const links = wanted.filter((one) => one.picture !== undefined).length;
  return { catalogue: wanted.length - links, links };
}

/** The catalogue whose card a pasted name takes first; none while the list is about nothing yet. */
export type Preferred = "tmdb" | "wikidata" | null;

/**
 * A section with catalogues of its own is searched in those alone, so any
 * card of the name will do. Everywhere else every catalogue answers, and
 * Wikidata's is the one to take: a list of food with "Pizza" in it wants the
 * dish, not the poster of a film by that name. A section of somebody's own
 * says nothing of what it holds, so it is Wikidata's, as Other is.
 */
export const preferredFor = (category: string | null): Preferred => {
  if (category === null || scopeFor(category) !== "all") return null;
  return "wikidata";
};

/**
 * The busy catalogues a pasted name waits for, rather than take another
 * catalogue's card in their place. Wikidata where its card is the one to take;
 * in a section with catalogues of its own, those (AniList for anime, TMDB for
 * films…), and not Wikidata, which answers everywhere; none while the list is
 * about nothing yet, when any card will do.
 */
export const waitsForIn =
  (category: string | null) =>
  (catalogue: string): boolean => {
    if (category === null) return false;
    if (scopeFor(category) === "all") return catalogue === "wikidata";
    return catalogue !== "wikidata" && catalogue !== "web";
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
 * association football, and "Muse (Q22151)" the band that a search by the
 * name does not reach.
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
 * Pictures from links need no such pause (the backend takes three at once).
 */
export const PASTE_PACE_MS = 1000;

// The waits for a busy site are the paste's own, shared with whatever else waits for one.
export { BUSY_FALLBACK_MS, BUSY_TRIES, BUSY_WAIT_MAX_MS, busyUntil } from "../../lib/busyWait";

/**
 * What the catalogue said of a name: its cards, and the catalogues that were
 * too busy to answer (`busy`) until when (`retryAt`). A plain list is cards
 * with every catalogue answering.
 */
export interface LookedUp {
  items: CatalogueItem[];
  busy?: readonly string[];
  retryAt?: number;
}

/** Why a pasted card came without a picture. */
export type MissReason = "notFound" | "searchLimit" | LinkFailure;

export interface PasteOptions {
  /** False once the box is gone: nothing more is asked, nothing handed over. */
  going?: () => boolean;
  preferred?: Preferred;
  /**
   * The busy catalogues a name waits for (`waitsForIn`); by default the
   * preferred one. A line with the subject's id waits for Wikidata.
   */
  waitFor?: (catalogue: string) => boolean;
  paceMs?: number;
  /**
   * How a line's own picture is kept, by its address; none for a guest,
   * whose lines with a picture come as their names alone.
   */
  link?: (ask: LinkAsk) => Promise<LinkedPicture>;
  /** A card came without a picture, and why. */
  onMissing?: (title: string, reason: MissReason) => void;
  /** What a picture from a link says is left of the day. */
  onQuota?: (quota: LinkQuota) => void;
  /**
   * A picture copied from another site came without the page it is from: a
   * house list is refused that way (PICTURE_LINK_NEEDED). A catalogue's or
   * Commons' picture names its own, so only the backend's answer can tell.
   */
  onPageless?: (title: string) => void;
  /** Waiting for a busy picture site until this time; null once it is asked again. */
  onWaiting?: (until: number | null) => void;
  /** The clock a busy site's time is read against. */
  now?: () => number;
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** One search for a name, as the paste reads it. */
interface Searched {
  items: CatalogueItem[];
  busy: readonly string[];
  retryAt?: number | undefined;
  /** Nothing was found while a catalogue it needs was busy (503 SOURCE_BUSY). */
  unknown: boolean;
}

/** What the catalogue gave a name in the end, and whether a busy one was given up on. */
interface Found {
  items: CatalogueItem[];
  stayedBusy?: true;
}

export interface PastedCard {
  title: string;
  imageUrl: string | null;
  /** A picture from a line's link, kept in the person's own folder. */
  pictureId?: string;
  key?: string;
  credit?: string | null;
  attribution?: PictureAttribution;
}

/**
 * The picture searches ran out partway (429 SEARCH_LIMIT): how many names
 * came without the catalogue being asked, or answering, and when searching
 * works again, if the backend said.
 */
export interface PasteLimited {
  unanswered: number;
  retryAt: number | null;
}

/**
 * Every pasted name as a card, in the order pasted, a few at a time. A name
 * the catalogue does not answer for, or fails on, comes as its name alone.
 * The name stays the way it was written: the catalogue differs by its case
 * only, and Wikidata writes "pizza" where a card wants "Pizza".
 *
 * Once the picture searches are used up, nothing more is asked: the names
 * left come as names alone, and what is said back is how many, and when.
 *
 * A line with its own picture's address asks no catalogue: the picture is
 * kept by `link`, with the page it is from on its attribution. Refused, or
 * without `link` (a guest), the card comes by its name, and `onMissing` says why.
 *
 * A busy site is waited for until the time it gives, and the same line asked
 * again: a picture's own site, a search that found nothing while a catalogue
 * it needs was busy (503 SOURCE_BUSY: "nothing by that name" is not known
 * then), and a search whose answer misses the catalogue the name waits for.
 * Past `BUSY_TRIES` or `BUSY_WAIT_MAX_MS`, the name takes what was found, or
 * goes alone, and `onMissing` says the site stayed busy.
 */
export async function cardsFor(
  wanted: readonly Wanted[],
  lookup: (query: string) => Promise<CatalogueItem[] | LookedUp>,
  onCard: (card: PastedCard, done: number) => void,
  {
    going = () => true,
    preferred = null,
    waitFor = (catalogue) => catalogue === preferred,
    paceMs = PASTE_PACE_MS,
    link,
    onMissing,
    onQuota,
    onPageless,
    onWaiting,
    now = Date.now,
  }: PasteOptions = {},
): Promise<PasteLimited | null> {
  // Set from inside the lookups: a cast, so the null it starts as is not taken for its type.
  let limit = null as { retryAt: number | null } | null;
  let unanswered = 0;
  // Waits for a busy site until the time it gave, saying so, and tells
  // whether to ask it again: not once it was asked often enough, nor for a
  // time too far off, nor when the box is gone meanwhile.
  const waitedOut = async (retryAt: number | null | undefined, tries: number) => {
    const until = busyUntil(retryAt, tries, now());
    if (until === null) return false;
    onWaiting?.(until);
    const wait = until - now();
    if (wait > 0) await pause(wait);
    onWaiting?.(null);
    return going();
  };
  // Wikidata finds a subject by its number as it does by a name, and then it
  // is the only answer: nothing depends on what else carries the name.
  // None at all once the searches ran out: undefined, not an empty answer.
  // A search that found nothing while a catalogue was busy is `unknown`.
  const ask = async (one: Wanted): Promise<Searched | undefined> => {
    if (limit !== null) return undefined;
    try {
      const answer = await lookup(
        one.id === undefined ? one.title : one.id.slice(one.id.indexOf(":") + 1),
      );
      return Array.isArray(answer)
        ? { items: answer, busy: [], unknown: false }
        : { items: answer.items, busy: answer.busy ?? [], retryAt: answer.retryAt, unknown: false };
    } catch (reason) {
      const error = errorOf(reason);
      if (error.kind === "sourceBusy") {
        return { items: [], busy: error.busy ?? [], retryAt: error.retryAt, unknown: true };
      }
      if (!isSearchLimit(reason)) return { items: [], busy: [], unknown: false };
      limit ??= { retryAt: searchLimitOf(reason) };
      return undefined;
    }
  };
  // A busy catalogue says so, and the name waits for it when its card is the
  // one to take, or when nothing could be found without it. One that says
  // nothing may still have been busy: the one this name is for gets a second
  // question before the name goes alone.
  const answerFor = async (one: Wanted): Promise<Found | undefined> => {
    const needed = one.id === undefined ? preferred : "wikidata";
    const waits = one.id === undefined ? waitFor : (catalogue: string) => catalogue === "wikidata";
    const waiting = (answer: Searched) => answer.unknown || answer.busy.some(waits);
    let first = await ask(one);
    for (let tries = 1; first !== undefined && waiting(first); tries++) {
      if (!(await waitedOut(first.retryAt, tries))) {
        return { items: first.items, stayedBusy: true };
      }
      const again = await ask(one);
      // The searches ran out meanwhile: what the last answer had, if anything.
      if (again === undefined) return first.unknown ? undefined : { items: first.items };
      first = again;
    }
    if (first === undefined) return undefined;
    if (needed === null ? first.items.length > 0 : first.items.some(from(needed))) {
      return { items: first.items };
    }
    if (limit !== null) return { items: first.items };
    if (paceMs > 0) await pause(paceMs);
    if (!going()) return { items: first.items };
    const second = await ask(one);
    return { items: second !== undefined && second.items.length > 0 ? second.items : first.items };
  };
  // A line's own picture: kept by its address, the page it is from on its
  // attribution. A refusal leaves the name, and says why; a busy site is
  // waited for, and the same line asked again.
  const linked = async (one: Wanted, url: string): Promise<PastedCard | MissReason> => {
    if (link === undefined) return "signIn";
    for (let tries = 1; ; tries++) {
      const answer = await linkedOnce(one, url);
      if (!(answer instanceof LinkRefused)) return answer;
      if (answer.reason !== "busy" || !(await waitedOut(answer.retryAt, tries))) {
        return answer.reason;
      }
    }
  };
  const linkedOnce = async (one: Wanted, url: string): Promise<PastedCard | LinkRefused> => {
    if (link === undefined) return new LinkRefused("signIn");
    try {
      const picture = await link({
        url,
        ...(one.page === undefined ? {} : { link: one.page }),
      });
      if (picture.quota !== null) onQuota?.(picture.quota);
      const attribution =
        one.page === undefined || picture.attribution?.link !== undefined
          ? picture.attribution
          : { ...(picture.attribution ?? { source: "web" }), link: one.page };
      const copied = picture.pictureId !== null && (attribution?.source ?? "web") === "web";
      if (copied && attribution?.link === undefined) onPageless?.(one.title);
      return {
        title: one.title,
        imageUrl: picture.imageUrl,
        ...(picture.pictureId === null ? {} : { pictureId: picture.pictureId }),
        ...(picture.credit === null ? {} : { credit: picture.credit }),
        ...(attribution === null ? {} : { attribution }),
      };
    } catch (failure) {
      const refused = linkRefusalOf(failure);
      if (refused.quota !== null) onQuota?.(refused.quota);
      return refused;
    }
  };
  type Answer = Found | undefined | PastedCard | MissReason;
  const answerOf = (one: Wanted): Promise<Answer> =>
    one.picture === undefined ? answerFor(one) : linked(one, one.picture);

  for (let start = 0; start < wanted.length; start += PASTE_AT_ONCE) {
    const few = wanted.slice(start, start + PASTE_AT_ONCE);
    const last = start + PASTE_AT_ONCE >= wanted.length;
    // Only the catalogues need the pause; a few links alone go on at once.
    const searched = few.some((one) => one.picture === undefined);
    const [answers] = await Promise.all([
      Promise.all(few.map(answerOf)),
      // Nothing is asked after the last few, or once the searches ran out,
      // so nothing is waited for.
      last || paceMs <= 0 || limit !== null || !searched ? undefined : pause(paceMs),
    ]);
    if (!going()) return null;
    few.forEach((one, index) => {
      const answer = answers[index];
      const done = start + index + 1;
      if (typeof answer === "string") {
        onMissing?.(one.title, answer);
        onCard({ title: one.title, imageUrl: null }, done);
        return;
      }
      if (answer !== undefined && !("items" in answer)) {
        onCard(answer, done);
        return;
      }
      if (answer === undefined) unanswered++;
      const card = pick(one, answer?.items ?? [], preferred);
      if (card === null) {
        onMissing?.(
          one.title,
          answer === undefined ? "searchLimit" : answer.stayedBusy === true ? "busy" : "notFound",
        );
      }
      onCard(
        card === null
          ? { title: one.title, imageUrl: null }
          : {
              title: one.title,
              imageUrl: card.imageUrl,
              key: card.id,
              ...(typeof card.credit === "string" ? { credit: card.credit } : {}),
              ...(card.attribution === null || card.attribution === undefined
                ? {}
                : { attribution: card.attribution }),
            },
        done,
      );
    });
  }
  return limit === null ? null : { unanswered, retryAt: limit.retryAt };
}
