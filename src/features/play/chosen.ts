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

/** The selection a chosen set was drawn from: a sample's source, or itself. */
export const sourceOf = (chosen: Chosen): Selection =>
  chosen.kind === "sample" ? chosen.source : chosen;

/** The id of the one tier the game only orders, whether or not it is still on the board. */
export function keepsTier(chosen: Chosen): string | null {
  const source = sourceOf(chosen);
  if (source.kind === "rows" && source.keepTier && !source.pool && source.tiers.length === 1) {
    return source.tiers[0] ?? null;
  }
  return source.kind === "picked" && source.keepTier ? source.tier : null;
}

/** The one tier the cards stay in, by its place on the board, or null when the game re-tiers them. */
export function keptTier(board: PlayBoard, chosen: Chosen): number | null {
  const tier = keepsTier(chosen);
  if (tier === null) return null;
  const index = board.tiers.findIndex((row) => row.id === tier);
  return index === -1 ? null : index;
}

/**
 * The part of the board a game was drawn from, by tier id and the pool
 * (game-scopes WIRE-SPEC): what the unplayed-cards choice may touch. A card
 * outside it never moves but to the place the game gave it.
 */
export interface Area {
  tiers: ReadonlySet<string>;
  pool: boolean;
}

export function areaOf(board: PlayBoard, chosen: Chosen): Area {
  const source = sourceOf(chosen);
  switch (source.kind) {
    case "all":
      return { tiers: new Set(board.tiers.map((tier) => tier.id)), pool: true };
    case "rows":
      return { tiers: new Set(source.tiers), pool: source.pool };
    case "picked":
      return source.tier === null
        ? { tiers: new Set(), pool: true }
        : { tiers: new Set([source.tier]), pool: false };
  }
}

/**
 * A tier the game was drawn from has left the board (a renamed one keeps its
 * id): the game cannot go on as if it were drawn from the rest, or from
 * everything (WIRE-SPEC rule 6).
 */
export function lostTier(board: PlayBoard, chosen: Chosen): boolean {
  const here = new Set(board.tiers.map((tier) => tier.id));
  const source = sourceOf(chosen);
  if (source.kind === "all") return false;
  const named = source.kind === "rows" ? source.tiers : source.tier === null ? [] : [source.tier];
  return named.some((tier) => !here.has(tier));
}

/**
 * Every ranked tier and nothing else: "Ranked". It is written as the tiers
 * that hold a card, in the board's order, as the app writes it, and read back
 * as such when the tiers named cover every tier that holds a card; empty ones
 * named besides do not count (WIRE-SPEC). A tier filled since the game began
 * makes it a choice of rows by name only: what the result may move is the
 * tiers named, either way.
 */
export function isRanked(board: PlayBoard, tiers: readonly string[]): boolean {
  const named = new Set(tiers);
  const here = new Set(board.tiers.map((tier) => tier.id));
  return (
    named.size > 0 &&
    tiers.every((tier) => here.has(tier)) &&
    board.tiers.every((tier) => tier.cardIds.length === 0 || named.has(tier.id))
  );
}

/** Which area a choice is, for the picker's "34 cards from …": a named one, or the board. */
export type AreaName =
  | { kind: "board" }
  | { kind: "pool" }
  | { kind: "ranked" }
  | { kind: "tier"; tier: PlayBoard["tiers"][number] };

export function areaName(board: PlayBoard, chosen: Chosen): AreaName {
  const source = sourceOf(chosen);
  const named = (id: string | null | undefined): AreaName => {
    const tier = board.tiers.find((row) => row.id === id);
    return tier === undefined ? { kind: "board" } : { kind: "tier", tier };
  };
  switch (source.kind) {
    case "all":
      return { kind: "board" };
    case "picked":
      if (source.tier === null) return { kind: "pool" };
      return source.keepTier ? named(source.tier) : { kind: "board" };
    case "rows":
      if (source.pool) return source.tiers.length === 0 ? { kind: "pool" } : { kind: "board" };
      if (source.keepTier && source.tiers.length === 1) return named(source.tiers[0]);
      return isRanked(board, source.tiers) ? { kind: "ranked" } : { kind: "board" };
  }
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

/** The random sizes offered, as on the app: 16, 32, 64, 128 and on, doubling, each below the cards there are. */
export function sampleSizes(count: number): number[] {
  const sizes: number[] = [];
  for (let size = 16; size < count; size *= 2) sizes.push(size);
  return sizes;
}

/** Replay uses the saved participants. “Everything” in a new picker uses the current board. */
export function replaySelection(board: PlayBoard, source: Chosen, ids: readonly string[]): Chosen {
  const candidates = chosenIds(board, source);
  const current = new Set(candidates);
  if (current.size === ids.length && ids.every((id) => current.has(id))) return source;
  return { kind: "sample", source: source.kind === "sample" ? source.source : source, ids };
}
