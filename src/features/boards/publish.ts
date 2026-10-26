import type { PublishRequest } from "../../api/lists";
import type { PublishedList } from "../../api/types";
import {
  BOARD_LIMITS,
  itemsIn,
  liveItems,
  newBoard,
  poolTier,
  rankedTiers,
  type Board,
  type NextUid,
} from "./model";

/** What stands between a board and the feed, in the order the settings show things. */
export type PublishProblem = "category" | "noItems" | "tooManyTiers" | "tooManyItems";

export function publishProblemsOf(board: Board): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (board.category === null) problems.push("category");
  if (liveItems(board).length === 0) problems.push("noItems");
  if (rankedTiers(board).length > BOARD_LIMITS.tiers) problems.push("tooManyTiers");
  if (liveItems(board).length > BOARD_LIMITS.items) problems.push("tooManyItems");
  return problems;
}

/**
 * The request the backend takes to publish a board: the snapshot the phone
 * sends. Cards go out ranked ones first, tier by tier, then the pool; a
 * picture of the person's own goes by id, and the backend makes the feed's
 * copy. Null while something stands in the way.
 */
export function publishRequestOf(board: Board): PublishRequest | null {
  if (publishProblemsOf(board).length > 0 || board.category === null) return null;
  const tiers = rankedTiers(board);
  const pool = poolTier(board);
  const ranked = tiers.flatMap((tier, index) =>
    itemsIn(board, tier.uid).map((item) => ({ item, tierIndex: index as number | null })),
  );
  const waiting =
    pool === null ? [] : itemsIn(board, pool.uid).map((item) => ({ item, tierIndex: null }));
  return {
    title: board.title.trim(),
    category: board.category,
    coverImageUrl: board.coverImageUrls.length === 1 ? (board.coverImageUrls[0] ?? null) : null,
    coverPictureId: null,
    coverImageUrls: board.coverImageUrls,
    tiers: tiers.map((tier) => ({
      label: tier.label,
      caption: tier.caption,
      colorLight: tier.colorLight,
      colorDark: tier.colorDark,
    })),
    items: [...ranked, ...waiting].map(({ item, tierIndex }) => ({
      title: item.title,
      imageUrl: item.pictureId === null ? item.imageUrl : null,
      pictureId: item.pictureId,
      tierIndex,
    })),
  };
}

/**
 * Somebody else's published list as a board of one's own, the phone's
 * "Save to my lists": their cards and tiers, and whichever arrangement was
 * asked for (theirs, the one on screen, or none). The author's name stays on
 * it; the published id does not, since this is a copy and not the list.
 */
export function boardFromList(
  list: PublishedList,
  rows: readonly (readonly number[])[] | null,
  now: number,
  nextUid: NextUid,
): Board {
  const base = newBoard(nextUid(), list.title, now, nextUid);
  const pool = poolTier(base);
  if (pool === null) return base;
  const tiers = list.tiers.map((tier, position) => ({
    uid: nextUid(),
    position,
    label: tier.label,
    caption: tier.caption,
    colorLight: tier.colorLight,
    colorDark: tier.colorDark,
    isPool: false,
  }));
  const placed = new Map<number, { tierUid: string; position: number }>();
  (rows ?? []).forEach((row, tierIndex) => {
    const tier = tiers[tierIndex];
    if (tier === undefined) return;
    row.forEach((cardIndex, position) => {
      if (!placed.has(cardIndex)) placed.set(cardIndex, { tierUid: tier.uid, position });
    });
  });
  let inPool = 0;
  const items = list.items.map((card, index) => {
    const place = placed.get(index) ?? { tierUid: pool.uid, position: inPool++ };
    return {
      uid: nextUid(),
      pictureId: null,
      tierUid: place.tierUid,
      position: place.position,
      title: card.title,
      imageUrl: card.imageUrl,
      source: "MANUAL" as const,
      deletedAt: null,
    };
  });
  return {
    ...base,
    category: list.category,
    authorName: list.authorName,
    tiers: [...tiers, { ...pool, position: tiers.length }],
    items,
  };
}
