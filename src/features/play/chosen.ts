import type { PlayBoard } from "./board";

/** The engine plays 2 to 64 cards; a bigger board chooses some first. */
export const MAX_CARDS = 64;

/** Fewer than this and Play is not offered at all (the design's rule). */
export const MIN_CARDS = 3;

/** A chosen part of a board may be as small as the engine allows: two cards, one duel. */
export const MIN_CHOSEN = 2;

/**
 * Which of a board's cards a game is over, kept with the game: a resumed game
 * knows which new cards belong to it, Apply knows whether to keep the cards in
 * their tier, and Play again starts from the same cards.
 *
 * - all: every card on the board.
 * - rows: whole tiers (by id) and the pool.
 * - picked: cards picked one by one in one row too big for a game; `tier` is
 *   null for the pool.
 *
 * `keepTier` counts only when the cards come from exactly one tier: they stay
 * in it and the game only puts them in order.
 */
export type Chosen =
  | { kind: "all" }
  | { kind: "rows"; tiers: readonly string[]; pool: boolean; keepTier: boolean }
  | { kind: "picked"; tier: string | null; ids: readonly string[]; keepTier: boolean };

export const EVERYTHING: Chosen = { kind: "all" };

/** The chosen cards still on the board, in the board's order. */
export function chosenIds(board: PlayBoard, chosen: Chosen): string[] {
  switch (chosen.kind) {
    case "all":
      return [...board.order];
    case "rows": {
      const tiers = new Set(chosen.tiers);
      return [
        ...board.tiers.filter((tier) => tiers.has(tier.id)).flatMap((tier) => tier.cardIds),
        ...(chosen.pool ? board.pool : []),
      ];
    }
    case "picked": {
      const picked = new Set(chosen.ids);
      return board.order.filter((id) => picked.has(id));
    }
  }
}

/** The one tier the cards stay in, by its place on the board, or null when the game re-tiers them. */
export function keptTier(board: PlayBoard, chosen: Chosen): number | null {
  const tier =
    chosen.kind === "rows" && chosen.keepTier && !chosen.pool && chosen.tiers.length === 1
      ? chosen.tiers[0]
      : chosen.kind === "picked" && chosen.keepTier
        ? chosen.tier
        : null;
  if (tier === null || tier === undefined) return null;
  const index = board.tiers.findIndex((row) => row.id === tier);
  return index === -1 ? null : index;
}

/** Whether a game can be played over this many cards. */
export const playable = (count: number): boolean => count >= MIN_CHOSEN && count <= MAX_CARDS;
