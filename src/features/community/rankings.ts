import { rowsOf, type ReaderRanking } from "../../api/community";
import type { PublishedItem, PublishedTier } from "../../api/types";
import { currentLocale, strings } from "../../strings";

/**
 * The readers' rankings worth a row. The site's own /r/ rankings share the
 * backend's collection, and one that was changed since carries the list's id
 * and a date, so the listing hands it over too: without a reader or a name it
 * is nobody's row.
 */
export const readersOf = (rankings: readonly ReaderRanking[]): ReaderRanking[] =>
  rankings.filter(
    (ranking) =>
      typeof ranking.uid === "string" &&
      ranking.uid !== "" &&
      typeof ranking.authorName === "string" &&
      Array.isArray(ranking.arrangement),
  );

/**
 * A reader's name as a row says it, or null for nobody named: the backend
 * writes its own English "Anonymous" for a reader without a name.
 */
export function readerName(name: string): string | null {
  const said = name.trim();
  return said === "" || said === "Anonymous" ? null : said;
}

/** A reader's ranking chosen to look at, kept in the page's history entry. */
interface KeptReader {
  listId: string;
  /** The list as it was then: after a republish the ranking may name other cards. */
  updatedAt: number;
  ranking: ReaderRanking;
}

type ListAt = { id: string; updatedAt: number };

/**
 * The reader chosen on this entry of the history, so Back, Forward and a
 * reload show their ranking again: the backend has no way to ask for one
 * reader's ranking alone, and paging to them again is long.
 */
export function readerKeptIn(state: unknown, list: ListAt): ReaderRanking | null {
  const kept = (state as { reader?: Partial<KeptReader> } | null)?.reader;
  if (typeof kept !== "object" || kept === null) return null;
  if (kept.listId !== list.id || kept.updatedAt !== list.updatedAt) return null;
  const ranking = kept.ranking;
  if (typeof ranking !== "object" || ranking === null || !Array.isArray(ranking.tierLabels)) {
    return null;
  }
  return readersOf([ranking])[0] ?? null;
}

/** The entry's state with this reader kept in it, or with none; whatever else it held stays. */
export function keepingReader(
  state: unknown,
  list: ListAt,
  ranking: ReaderRanking | null,
): Record<string, unknown> {
  const rest: Record<string, unknown> =
    typeof state === "object" && state !== null ? { ...(state as Record<string, unknown>) } : {};
  delete rest.reader;
  if (ranking === null) return rest;
  const reader: KeptReader = { listId: list.id, updatedAt: list.updatedAt, ranking };
  return { ...rest, reader };
}

export interface Placing {
  tiers: PublishedTier[];
  rows: number[][];
  pool: number[];
}

/**
 * The cards in each tier, left to right, as the reader left them. A ranking
 * kept before the backend kept that order has no rows (and a reply from
 * before the field has none at all): its cards stand in the list's order.
 */
function rowsFrom(
  ranking: Pick<ReaderRanking, "arrangement" | "rows">,
  tierCount: number,
  itemCount: number,
): number[][] {
  if (Array.isArray(ranking.rows) && ranking.rows.length > 0) {
    return rowsOf(ranking.rows, tierCount, itemCount);
  }
  const rows: number[][] = Array.from({ length: tierCount }, () => []);
  for (let position = 0; position < itemCount; position++) {
    const tier = ranking.arrangement[position] ?? null;
    if (tier !== null) rows[tier]?.push(position);
  }
  return rows;
}

/** The words a reader gave the tiers, one per tier; null where a tier keeps the list's own. */
export function readerLabels(
  tierCount: number,
  ranking: Pick<ReaderRanking, "tierLabels">,
): (string | null)[] {
  return Array.from({ length: tierCount }, (_, index) => {
    const label = ranking.tierLabels[index];
    return typeof label === "string" && label.trim() !== "" ? label : null;
  });
}

/** The author's cards where a reader put them, under the words the reader gave the tiers. */
export function placedBy(
  list: { tiers: readonly PublishedTier[]; items: readonly PublishedItem[] },
  ranking: Pick<ReaderRanking, "arrangement" | "rows" | "tierLabels">,
): Placing {
  const rows = rowsFrom(ranking, list.tiers.length, list.items.length);
  const placed = new Set(rows.flat());
  const pool = list.items.map((_, position) => position).filter((at) => !placed.has(at));
  const labels = readerLabels(list.tiers.length, ranking);
  const tiers = list.tiers.map((tier, index) => {
    const label = labels[index] ?? null;
    return label === null ? tier : { ...tier, label };
  });
  return { tiers, rows, pool };
}

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (when: number): number => {
  const day = new Date(when);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** When a ranking was last placed, the way the app says days: today, yesterday, or the date. */
export function placedOn(when: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(when)) / DAY);
  if (days <= 0) return strings.rankings.today;
  if (days === 1) return strings.rankings.yesterday;
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" }).format(new Date(when));
}
