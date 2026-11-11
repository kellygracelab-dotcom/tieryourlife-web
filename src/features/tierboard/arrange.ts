import type { PublishedItem, PublishedTier } from "../../api/types";

export interface Arrangement {
  /** Item positions per tier, in the order they appear on the list. */
  rows: number[][];
  pool: number[];
  /** False when the snapshot predates arrangements travelling with a list. */
  known: boolean;
}

// The author's own placement. Anything the snapshot cannot place is unranked,
// which is what the phone shows too.
export function arrange(list: {
  tiers: readonly PublishedTier[];
  items: readonly PublishedItem[];
}): Arrangement {
  const rows: number[][] = list.tiers.map(() => []);
  const pool: number[] = [];
  let known = false;

  list.items.forEach((item, position) => {
    const index = item.tierIndex ?? null;
    if (index !== null) known = true;
    const row = index === null ? undefined : rows[index];
    if (row === undefined) pool.push(position);
    else row.push(position);
  });

  return { rows, pool, known };
}

/** What a stored ranking leaves unranked: every item its rows do not mention. */
export function poolOf(
  rows: readonly (readonly number[])[],
  itemCount: number,
  order?: readonly number[],
): number[] {
  const placed = new Set(rows.flat());
  const indexes = Array.from({ length: itemCount }, (_, i) => i);
  const ordered =
    order === undefined
      ? indexes
      : [
          ...new Set([
            ...order.filter((i) => Number.isInteger(i) && i >= 0 && i < itemCount),
            ...indexes,
          ]),
        ];
  return ordered.filter((i) => !placed.has(i));
}
