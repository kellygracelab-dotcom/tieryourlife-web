/**
 * What Play needs of a board, whoever's it is: the cards by id and the ranked
 * tiers with the cards in them. One's own board (/b/) and somebody else's list
 * (/l/) hand in the same two arrays; everything else here works on ids.
 */

/** A card as a duel shows it. */
export interface PlayCard {
  id: string;
  name: string;
  imageUrl: string | null;
}

/** A ranked tier and its cards, left to right. The pool is not one: it is every card no tier holds. */
export interface PlayTier {
  /** Stable while the game is saved: the board's tier uid, or the list's tier index as text. */
  id: string;
  label: string;
  caption: string | null;
  colorLight: string;
  colorDark: string;
  cardIds: readonly string[];
}

/** The board as Play reads it, every card once. */
export interface PlayBoard {
  cards: ReadonlyMap<string, PlayCard>;
  tiers: readonly PlayTier[];
  pool: readonly string[];
  /**
   * Every card in the engine's order for a board: tiers top to bottom, left to
   * right, then the pool. That order breaks every tie (play-mode-spec.md).
   */
  order: readonly string[];
}

/** Tier rows that name a card twice, or one that is not there, are read as holding it once. */
export function boardOf(cards: readonly PlayCard[], tiers: readonly PlayTier[]): PlayBoard {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const placed = new Set<string>();
  const rows = tiers.map((tier) => ({
    ...tier,
    cardIds: tier.cardIds.filter((id) => {
      if (!byId.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    }),
  }));
  const pool = [...byId.keys()].filter((id) => !placed.has(id));
  return {
    cards: byId,
    tiers: rows,
    pool,
    order: [...rows.flatMap((tier) => tier.cardIds), ...pool],
  };
}

/** A card that left the board mid-game still has a place on screen, nameless. */
export const cardOf = (board: PlayBoard, id: string): PlayCard =>
  board.cards.get(id) ?? { id, name: "", imageUrl: null };
