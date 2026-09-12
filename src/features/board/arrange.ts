import type { PublishedItem, PublishedList, PublishedTier } from "../../api/types";

export interface Row {
  tier: PublishedTier;
  items: PublishedItem[];
}

export interface Arrangement {
  rows: Row[];
  pool: PublishedItem[];
  /** False when the snapshot predates arrangements travelling with a list. */
  known: boolean;
}

// The author's own placement. Anything the snapshot cannot place is unranked,
// which is what the phone shows too.
export function arrange(list: Pick<PublishedList, "tiers" | "items">): Arrangement {
  const rows: Row[] = list.tiers.map((tier) => ({ tier, items: [] }));
  const pool: PublishedItem[] = [];
  let known = false;

  for (const item of list.items) {
    const index = item.tierIndex ?? null;
    if (index !== null) known = true;
    const row = index === null ? undefined : rows[index];
    if (row === undefined) pool.push(item);
    else row.items.push(item);
  }

  return { rows, pool, known };
}
