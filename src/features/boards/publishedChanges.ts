import { useEffect, useState } from "react";
import type { PublishedList } from "../../api/types";
import { liveItems, rankedTiers, type Board } from "./model";

/**
 * How many cards differ between the board and the list its link shows: added
 * here, moved to another tier, or gone (the Designer, 23.11: "27 changes not
 * published"). Cards are matched by name; each counts once.
 */
export function changesAgainst(board: Board, list: PublishedList): number {
  const keyOf = (title: string) => title.trim().toLocaleLowerCase();
  const out = new Map<string, (number | null)[]>();
  for (const item of list.items) {
    const key = keyOf(item.title);
    out.set(key, [...(out.get(key) ?? []), item.tierIndex ?? null]);
  }
  const tiers = rankedTiers(board).map((tier) => tier.uid);
  let changed = 0;
  for (const item of liveItems(board)) {
    const at = tiers.indexOf(item.tierUid);
    const tier = at === -1 ? null : at;
    const waiting = out.get(keyOf(item.title));
    if (waiting === undefined || waiting.length === 0) {
      changed++;
      continue;
    }
    const same = waiting.indexOf(tier);
    if (same !== -1) waiting.splice(same, 1);
    else {
      waiting.shift();
      changed++;
    }
  }
  for (const left of out.values()) changed += left.length;
  return changed;
}

/**
 * The count of changes the board has over its list while it is behind, read
 * once per edit; null until known, or when the list could not be read.
 */
export function usePublishedChanges(
  board: Board | null,
  behind: boolean,
  load: (id: string) => Promise<PublishedList>,
): number | null {
  const id = behind && board !== null ? board.publishedId : null;
  // Read again after each Update: the list is then another one.
  const key = id === null ? null : `${id}@${board?.publishedEditedAt ?? ""}`;
  const [known, setKnown] = useState<{ key: string; list: PublishedList } | null>(null);
  useEffect(() => {
    if (key === null || id === null) return;
    let current = true;
    load(id).then(
      (list) => current && setKnown({ key, list }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [key, id, load]);
  if (board === null || key === null || known === null || known.key !== key) return null;
  return changesAgainst(board, known.list);
}
