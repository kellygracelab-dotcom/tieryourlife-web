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
  if (
    board.takenFrom !== source.id ||
    board.category !== source.category ||
    board.topic !== null ||
    board.topicOff
  )
    return null;
  const cards = liveItems(board);
  const tiers = rankedTiers(board);
  if (source.items.length !== cards.length || source.tiers.length !== tiers.length) return null;
  for (const locale of ["", ...Object.keys(source.translations ?? {})]) {
    const list = listIn(source, locale);
    if (
      board.title !== list.title ||
      !tiers.every((t, i) => {
        const s = list.tiers[i]!;
        return (
          t.label === s.label &&
          t.caption === s.caption &&
          t.colorLight.toLowerCase() === s.colorLight.toLowerCase() &&
          t.colorDark.toLowerCase() === s.colorDark.toLowerCase()
        );
      })
    )
      continue;
    const cardKey = (c: { title: string; imageUrl: string | null; credit?: string | null }) =>
      JSON.stringify([c.title, c.imageUrl, c.credit ?? null]);
    const positions = new Map<string, number[]>();
    for (let i = list.items.length - 1; i >= 0; i--) {
      const key = cardKey(list.items[i]!);
      const bucket = positions.get(key);
      if (bucket) bucket.push(i);
      else positions.set(key, [i]);
    }
    const byUid = new Map<string, number>();
    for (const card of cards) {
      const index = positions.get(cardKey(card))?.pop();
      if (index === undefined || card.pictureId !== null) break;
      byUid.set(card.uid, index);
    }
    if (byUid.size === cards.length)
      return tiers.map((t) => itemsIn(board, t.uid).map((c) => byUid.get(c.uid)!));
  }
  return null;
}
