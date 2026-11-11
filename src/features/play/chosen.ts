import type { PlayBoard } from "./board";

/** Fewer than this and Play is not offered at all (the design's rule). */
export const MIN_CARDS = 3;

/** A chosen part of a board may be as small as the engine allows: two cards, one duel. */
export const MIN_CHOSEN = 2;

/** The source selection for a new game. A sample also keeps its exact members. */
export type Selection =
  | { kind: "all" }
  | { kind: "rows"; tiers: readonly string[]; pool: boolean; keepTier: boolean }
  | { kind: "picked"; tier: string | null; ids: readonly string[]; keepTier: boolean };

export type Chosen = Selection | { kind: "sample"; source: Selection; ids: readonly string[] };

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
    case "sample":
      return chosen.ids.filter((id) => board.cards.has(id));
    case "picked": {
      const picked = new Set(chosen.ids);
      return board.order.filter((id) => picked.has(id));
    }
  }
}

/** The one tier the cards stay in, by its place on the board, or null when the game re-tiers them. */
export function keptTier(board: PlayBoard, chosen: Chosen): number | null {
  if (chosen.kind === "sample") return keptTier(board, chosen.source);
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
export const playable = (count: number): boolean => count >= MIN_CHOSEN;

/** Sample without replacement, then keep the board order for engine tie breaks. */
export function sampleIds(ids: readonly string[], count: number, random = Math.random): string[] {
  const shuffled = [...ids];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const picked = new Set(shuffled.slice(0, count));
  return ids.filter((id) => picked.has(id));
}

export function sampleSizes(count: number): number[] {
  const sizes: number[] = [];
  for (let size = 16; size <= count; size *= 2) sizes.push(size);
  return sizes;
}

/** Replay uses the saved participants. “Everything” in a new picker uses the current board. */
export function replaySelection(board: PlayBoard, source: Chosen, ids: readonly string[]): Chosen {
  const candidates = chosenIds(board, source);
  const current = new Set(candidates);
  if (current.size === ids.length && ids.every((id) => current.has(id))) return source;
  return { kind: "sample", source: source.kind === "sample" ? source.source : source, ids };
}
