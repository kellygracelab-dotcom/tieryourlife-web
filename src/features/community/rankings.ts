import type { ReaderRanking } from "../../api/community";
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

export interface Placing {
  tiers: PublishedTier[];
  rows: number[][];
  pool: number[];
}

/** The author's cards where a reader put them, under the words the reader gave the tiers. */
export function placedBy(
  list: { tiers: readonly PublishedTier[]; items: readonly PublishedItem[] },
  ranking: Pick<ReaderRanking, "arrangement" | "tierLabels">,
): Placing {
  const rows: number[][] = list.tiers.map(() => []);
  const pool: number[] = [];
  list.items.forEach((_, position) => {
    const tier = ranking.arrangement[position] ?? null;
    const row = tier === null ? undefined : rows[tier];
    if (row === undefined) pool.push(position);
    else row.push(position);
  });
  const tiers = list.tiers.map((tier, index) => {
    const label = ranking.tierLabels[index];
    return typeof label === "string" && label.trim() !== "" ? { ...tier, label } : tier;
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
