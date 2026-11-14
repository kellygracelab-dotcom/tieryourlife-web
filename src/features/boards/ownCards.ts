import type { AddedCard, RankingsPage, ReaderRanking } from "../../api/community";
import type { PublishedList } from "../../api/types";
import { copyRankingOf } from "./copyRanking";
import type { Board } from "./model";

/**
 * One's own cards in a ranking of a list (K3): the cards, and the rows with
 * them in, `N + k` for `addedCards[k]`, N the list's cards.
 */
export interface OwnCards {
  rows: readonly (readonly number[])[];
  addedCards: readonly AddedCard[];
}

/** The cards of one's own on the board saved from the list, where they stand on it; null when it has none. */
export function ownCardsOfBoard(board: Board, list: PublishedList): OwnCards | null {
  const ranking = copyRankingOf(board, list);
  return ranking === null || ranking.addedCards.length === 0
    ? null
    : { rows: ranking.rows, addedCards: ranking.addedCards };
}

/**
 * The cards of one's own a ranking already went out with, as the backend
 * keeps them: sent back as they are, the backend keeps its copies of them.
 */
export function ownCardsOfRanking(ranking: ReaderRanking): OwnCards | null {
  const cards = ranking.addedCards ?? [];
  if (cards.length === 0) return null;
  return {
    rows: ranking.allRows ?? [],
    addedCards: cards.map((card) => ({
      title: card.title,
      ...(card.imageUrl === null ? {} : { imageUrl: card.imageUrl }),
      ...(card.attribution === undefined ? {} : { attribution: card.attribution }),
      ...(card.credit === undefined || card.credit === null ? {} : { credit: card.credit }),
    })),
  };
}

/**
 * Mine's rows for the list's cards, as the list page shows them, with one's
 * own cards in the tiers they stood in: a ranking sent without them would
 * take them away (Coordinator, 14.11).
 */
export function withOwnCards(
  mine: readonly (readonly number[])[],
  listCards: number,
  own: OwnCards,
): { rows: number[][]; addedCards: AddedCard[] } {
  const tiers = Math.max(mine.length, own.rows.length);
  return {
    rows: Array.from({ length: tiers }, (_, tier) => [
      ...(mine[tier] ?? []).filter((at) => at < listCards),
      ...(own.rows[tier] ?? []).filter(
        (at) => at >= listCards && at < listCards + own.addedCards.length,
      ),
    ]),
    addedCards: [...own.addedCards],
  };
}

/** Pages enough of the list's rankings to find one's own; null when it is not among them. */
export async function findMyRanking(
  load: (after: string | null) => Promise<RankingsPage>,
  pages = 70,
): Promise<ReaderRanking | null> {
  let after: string | null = null;
  for (let page = 0; page < pages; page++) {
    const answer: RankingsPage = await load(after);
    const mine = answer.rankings.find((ranking) => ranking.mine && ranking.isAuthor !== true);
    if (mine !== undefined) return mine;
    if (answer.nextCursor === null) return null;
    after = answer.nextCursor;
  }
  return null;
}
