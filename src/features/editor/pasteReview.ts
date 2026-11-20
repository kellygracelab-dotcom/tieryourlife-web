import type {
  PictureConfidence,
  PictureDoubt,
  PictureKind,
  PictureScope,
  PictureSource,
} from "../../api/pictures";
import type { MissReason, PastedCard } from "./paste";

/** What a catalogue's answer says of its picture: what it shows, and whose it is. */
export interface PictureOrigin {
  kind: PictureKind;
  source: PictureSource;
  subtitle: string | null;
  /** How sure the backend was of it (picture search, stage 1); absent from an older backend. */
  confidence?: PictureConfidence;
  /** Why not more sure, in the backend's words. */
  doubts?: readonly PictureDoubt[];
}

/**
 * One pasted name as the check before the board shows it: the card it would
 * become, where its picture came from (a catalogue's answer, the line's own
 * link, or none), why none came, and whether the person chose it themselves.
 */
export interface PasteRow {
  /** Its place in the paste: the cards go on the board in this order. */
  index: number;
  card: PastedCard;
  /** The catalogue's answer the picture is from; "link" for the line's own; null without one. */
  origin: PictureOrigin | "link" | null;
  /** Why the search brought no picture; null when one came, or the person said none. */
  missing: MissReason | null;
  /** Picked by the person, or left without on purpose: nothing about it is in doubt. */
  chosen: boolean;
  /** A house card's picture copied from another site without the page it is from. */
  pageless: boolean;
  /** Picked by the person from a search: its catalogue and its place in the answers, from 0. */
  picked?: { source: string; at: number } | null;
}

/** A kind of picture that can be in doubt: the web's say nothing of what they show. */
export type Doubt = Exclude<PictureKind, "web">;

/**
 * The kinds of picture each area expects. A section with catalogues of its
 * own (`film_tv`, `anime`…) expects theirs; Wikidata's "thing" is in doubt
 * there, since it answers everywhere with whatever carries the name ("Mario"
 * the singer in a list of games). Music, people and animals take Wikidata's
 * pictures as their own. Sport and food have no catalogue of their own: there
 * a poster, a cover or an album is the doubt, a photo of a thing is not. An
 * area this does not know (Other, a section of somebody's own, nothing yet)
 * expects nothing, so nothing in it is in doubt.
 */
const EXPECTED: Record<string, readonly PictureKind[]> = {
  film_tv: ["movie", "tv", "person"],
  anime: ["anime", "manga", "character"],
  games: ["game"],
  music: ["artist", "album", "thing"],
  books: ["book"],
  people: ["person", "thing"],
  animals: ["animal", "thing"],
  sport: ["thing", "person"],
  food: ["thing", "animal"],
};

/**
 * What a pasted name's pictures are compared with: the area chosen to look
 * in, or, when that is All, what the list itself is about. A list of football
 * clubs looked up everywhere still wants clubs, not film posters.
 */
export const expectedArea = (scope: PictureScope, category: string | null): string | null =>
  scope !== "all" ? scope : category;

/**
 * The kind of a picture that looks wrong for the area, or null when it fits
 * or nothing is known. The web's pictures say nothing of what they show.
 */
export function doubtOf(origin: PictureOrigin, area: string | null): Doubt | null {
  const { kind } = origin;
  if (area === null || kind === "web") return null;
  const expected = EXPECTED[area];
  if (expected === undefined) return null;
  return expected.includes(kind) ? null : kind;
}

/**
 * A row's doubt by the kind its picture shows: none once the person chose,
 * nor for a picture of their own link, nor where the backend judged it (then
 * `rowReason` says).
 */
export const rowDoubt = (row: PasteRow, area: string | null): Doubt | null =>
  row.chosen || row.origin === null || row.origin === "link" || row.origin.confidence !== undefined
    ? null
    : doubtOf(row.origin, area);

/** A backend's doubt this site has no words for: it is not sure, and says no more. */
export type Reason = PictureDoubt | "unsure";

/**
 * Why a row the backend judged needs a look (picture search, stage 1): every
 * picture it was not sure of, with its first reason; null for a sure one, one
 * the person chose, and anything an older backend found. A list without a
 * section is no reason by itself: every row would carry it, and the mark
 * would say nothing (QA 19.11, D7).
 */
export function rowReason(row: PasteRow): Reason | null {
  if (row.chosen || row.origin === null || row.origin === "link") return null;
  const { confidence, doubts } = row.origin;
  if (confidence === undefined || confidence === "high") return null;
  const said = doubts?.filter((doubt) => doubt !== "noSection");
  if (doubts !== undefined && doubts.length > 0 && said?.length === 0) return null;
  return said?.[0] ?? "unsure";
}

/** A row whose picture is in doubt, by the backend's word or by its kind. */
export const inDoubt = (row: PasteRow, area: string | null): boolean =>
  rowReason(row) !== null || rowDoubt(row, area) !== null;

/** A row the search left without a picture: nothing found, or a refusal. */
export const isUnfound = (row: PasteRow): boolean =>
  row.card.imageUrl === null && !row.chosen && row.missing !== null;

/** A row the person should look at: a picture of the wrong kind, or none found. */
export const needsLook = (row: PasteRow, area: string | null): boolean =>
  inDoubt(row, area) || isUnfound(row);

/**
 * The rows as the check shows them: those to look at first, the rest after,
 * each in the order pasted. Worked out once, when the search is done, so a
 * row the person fixes stays where it is.
 */
export const reviewOrder = (rows: readonly PasteRow[], area: string | null): PasteRow[] => [
  ...rows.filter((row) => needsLook(row, area)),
  ...rows.filter((row) => !needsLook(row, area)),
];

export interface PasteSummary {
  names: number;
  /** A picture, and nothing in doubt about it. */
  right: number;
  /** A picture of a kind the area does not expect. */
  doubtful: number;
  /** No picture, found or left so. */
  none: number;
}

/** The check's line over the rows: every name is in exactly one of the three. */
export function summaryOf(rows: readonly PasteRow[], area: string | null): PasteSummary {
  let doubtful = 0;
  let none = 0;
  for (const row of rows) {
    if (row.card.imageUrl === null) none++;
    else if (inDoubt(row, area)) doubtful++;
  }
  return { names: rows.length, right: rows.length - doubtful - none, doubtful, none };
}
