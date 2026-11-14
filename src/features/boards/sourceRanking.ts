import type { PublishedList } from "../../api/types";
import { localStorageStore } from "../../lib/storage";
import { listIn } from "../../lib/translated";
import { liveItems, rankedTiers, itemsIn, type Board } from "./model";

const editedKey = (uid: string) => "tyl:ranking-edited:" + uid;
export const noteRankingEdit = (uid: string) => localStorageStore.write(editedKey(uid), "yes");
export const hasRankingEdit = (uid: string) => localStorageStore.read(editedKey(uid)) === "yes";

/** Published cards are positional. Recover their positions from the snapshot,
 * including duplicate cards, without using the board's current tier order. */
export function rowsOfSource(board: Board, source: PublishedList): number[][] | null {
  const byUid = sourceIndexes(board, source);
  if (byUid === null) return null;
  return rankedTiers(board).map((t) => itemsIn(board, t.uid).map((c) => byUid.get(c.uid)!));
}

/**
 * Each card of a copy by its place in the list it was saved from, or null
 * when the copy is no longer that list's cards and tiers: renamed, given
 * cards of its own, or saved from another version that differs.
 */
export function sourceIndexes(board: Board, source: PublishedList): Map<string, number> | null {
  if (board.takenFrom !== source.id) return null;
  const words = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const cards = liveItems(board);
  const tiers = rankedTiers(board);
  if (source.items.length !== cards.length || source.tiers.length !== tiers.length) return null;
  candidates: for (const locale of ["", ...Object.keys(source.translations ?? {})]) {
    const list = listIn(source, locale);
    if (
      words(board.title) !== words(list.title) ||
      !tiers.every((t, i) => {
        const s = list.tiers[i]!;
        return words(t.label) === words(s.label) && words(t.caption) === words(s.caption);
      })
    )
      continue;
    const cardKey = (c: { title: string; imageUrl: string | null; credit?: string | null }) =>
      JSON.stringify([words(c.title), c.imageUrl]);
    const byUid = new Map<string, number>();
    const used = new Set<number>();
    if (board.origin?.version === source.updatedAt) {
      for (const card of cards) {
        const at = card.sourceIndex;
        if (at === undefined) continue;
        const item = list.items[at];
        if (!item || used.has(at) || card.pictureId !== null || cardKey(item) !== cardKey(card))
          continue candidates;
        byUid.set(card.uid, at);
        used.add(at);
      }
    }
    const positions = new Map<string, number[]>();
    for (let i = list.items.length - 1; i >= 0; i--) {
      if (used.has(i)) continue;
      const key = cardKey(list.items[i]!);
      const bucket = positions.get(key);
      if (bucket) bucket.push(i);
      else positions.set(key, [i]);
    }
    for (const card of cards) {
      if (byUid.has(card.uid)) continue;
      const index = positions.get(cardKey(card))?.pop();
      if (index === undefined || card.pictureId !== null) break;
      byUid.set(card.uid, index);
    }
    if (byUid.size === cards.length) return byUid;
  }
  return null;
}
