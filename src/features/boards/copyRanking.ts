import { ADDED_CARDS_MAX, type AddedCard } from "../../api/community";
import type { ApiError } from "../../api/errors";
import type { PublishedItem, PublishedList } from "../../api/types";
import { listIn } from "../../lib/translated";
import { fill, strings } from "../../strings";
import { failureText } from "../editor/failureText";
import { itemsIn, liveItems, poolTier, rankedTiers, type Board, type BoardItem } from "./model";

/**
 * A board saved from somebody else's list, as one's ranking of that list
 * (CONTRACT K3): the list's cards by their place in it, and the board's
 * other cards as one's own, `N + k` in the rows for `addedCards[k]`.
 */
export interface CopyRanking {
  /** One row per tier of the list, left to right as on the board. */
  rows: number[][];
  /** The board's words for its tiers, which the ranking keeps as the reader's. */
  tierLabels: string[];
  /** At most fifty: the ranked ones first, tier by tier, then the pool's. */
  addedCards: AddedCard[];
}

const words = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const cardKey = (card: { title: string; imageUrl: string | null }) =>
  JSON.stringify([words(card.title), card.imageUrl]);

/**
 * Which of the board's cards are the list's, by place: the place it was
 * saved from while the list is still at that version, else the first card of
 * the same name and picture not taken yet. A picture of one's own is never
 * the list's.
 */
function listCardsOf(
  cards: readonly BoardItem[],
  items: readonly PublishedItem[],
  sameVersion: boolean,
): Map<string, number> {
  const byUid = new Map<string, number>();
  const used = new Set<number>();
  if (sameVersion) {
    for (const card of cards) {
      const at = card.sourceIndex;
      const item = at === undefined ? undefined : items[at];
      if (at === undefined || item === undefined || used.has(at) || card.pictureId !== null)
        continue;
      if (cardKey(item) !== cardKey(card)) continue;
      byUid.set(card.uid, at);
      used.add(at);
    }
  }
  const positions = new Map<string, number[]>();
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item === undefined || used.has(i)) continue;
    const key = cardKey(item);
    const bucket = positions.get(key);
    if (bucket) bucket.push(i);
    else positions.set(key, [i]);
  }
  for (const card of cards) {
    if (byUid.has(card.uid) || card.pictureId !== null) continue;
    const index = positions.get(cardKey(card))?.pop();
    if (index !== undefined) byUid.set(card.uid, index);
  }
  return byUid;
}

/** A card of one's own as the ranking takes it: as a publish sends a card, without a place. */
export function addedCardOf(card: BoardItem): AddedCard {
  return {
    title: card.title,
    ...(card.pictureId !== null
      ? { pictureId: card.pictureId }
      : card.imageUrl === null
        ? {}
        : { imageUrl: card.imageUrl }),
    ...(card.credit === null ? {} : { credit: card.credit }),
    ...(card.attribution === undefined ? {} : { attribution: card.attribution }),
  };
}

/**
 * The board as one's ranking of the list it was saved from, or null when it
 * cannot be one: not saved from that list, or with other tiers than the
 * list's (a ranking places the list's cards in the list's tiers). Cards past
 * the fiftieth of one's own stay out: the pool's go first.
 */
export function copyRankingOf(board: Board, source: PublishedList): CopyRanking | null {
  if (board.takenFrom !== source.id) return null;
  const tiers = rankedTiers(board);
  if (tiers.length !== source.tiers.length) return null;
  const cards = liveItems(board);
  const sameVersion = board.origin?.version === source.updatedAt;
  // The list in whichever of its languages the board was saved in.
  let theList = new Map<string, number>();
  for (const locale of ["", ...Object.keys(source.translations ?? {})]) {
    const found = listCardsOf(cards, listIn(source, locale).items, sameVersion);
    if (found.size > theList.size) theList = found;
  }
  const pool = poolTier(board);
  const inOrder = [
    ...tiers.flatMap((tier) => itemsIn(board, tier.uid)),
    ...(pool === null ? [] : itemsIn(board, pool.uid)),
  ];
  const added = new Map<string, number>();
  const addedCards: AddedCard[] = [];
  for (const card of inOrder) {
    if (theList.has(card.uid) || addedCards.length >= ADDED_CARDS_MAX) continue;
    added.set(card.uid, source.items.length + addedCards.length);
    addedCards.push(addedCardOf(card));
  }
  return {
    rows: tiers.map((tier) =>
      itemsIn(board, tier.uid).flatMap((card) => {
        const at = theList.get(card.uid) ?? added.get(card.uid);
        return at === undefined ? [] : [at];
      }),
    ),
    tierLabels: tiers.map((tier) => tier.label),
    addedCards,
  };
}

/**
 * What a ranking that was not kept says (K3), in publishing's words where it
 * fails as a publish does: a refused picture names the card of one's own it
 * is on.
 */
export function rankingFailureText(error: ApiError, added: readonly AddedCard[] = []): string {
  switch (error.kind) {
    case "pictureRefused": {
      const title = error.addedIndex === undefined ? undefined : added[error.addedIndex]?.title;
      return title === undefined
        ? strings.new.failedPictureRefused
        : fill(strings.new.failedPictureRefusedCard, { title });
    }
    case "sourceChanged":
      return strings.rank.failedChanged;
    case "notFound":
      return strings.rank.failedGone;
    case "offline":
      return strings.rank.failedOffline;
    case "banned":
      return strings.rankings.showBanned;
    case "notSignedIn":
    case "unauthenticated":
      return strings.rankings.signInToShow;
    case "invalid":
    case "tooManyRequests":
    case "tooLarge":
      return failureText(error, "new");
    default:
      return strings.rank.failedOther;
  }
}
