import type { PlayBoard } from "./board";
import { areaOf, keepsTier, keptTier, lostTier, type Chosen } from "./chosen";
import {
  duels,
  duelsPlayed,
  isThin,
  nextPair,
  outcomeOf,
  mainGame,
  refinePairs,
  result,
  SOLID_DUELS,
  standing,
  swissRounds,
  type GameKind,
  type GameSpec,
  type Outcome,
  type Pair,
} from "./engine";

/**
 * A game as the site keeps it: the engine's spec and answers, and the cards
 * behind its numbers (card i is ids[i]). Everything on screen is worked out
 * from this, so a saved game is this and nothing else.
 */
export interface Game {
  spec: GameSpec;
  ids: string[];
  history: Outcome[];
  startedAt: number;
  /**
   * The close calls asked after the game, fixed when refining starts at duel
   * `from` (play-mode-spec.md: "The pairs are fixed when refining starts").
   * Absent until Refine is pressed; present, Refine is used up.
   */
  refineFixed?: { from: number; pairs: Pair[] };
  chosen: Chosen;
}

export function newGame(
  kind: GameKind,
  ids: readonly string[],
  chosen: Chosen,
  seed: number,
  now: number,
): Game {
  return {
    spec: { kind, count: ids.length, seed, refine: false },
    ids: [...ids],
    history: [],
    startedAt: now,
    chosen,
  };
}

/** A seed the engine takes: a signed 32-bit integer, from any source of chance in [0, 1). */
export const seedOf = (random: () => number): number => Math.floor(random() * 0x1_0000_0000) | 0;

/** The pair to ask now, first on the left, or null when the game is over. */
export function currentPair(game: Game): Pair | null {
  const fixed = game.refineFixed;
  if (fixed !== undefined) return fixed.pairs[game.history.length - fixed.from] ?? null;
  return nextPair({ ...game.spec, refine: false }, game.history);
}

export const isOver = (game: Game): boolean => currentPair(game) === null;

function answer(game: Game, winner: number | null): Game {
  const pair = currentPair(game);
  return pair === null ? game : { ...game, history: [...game.history, outcomeOf(pair, winner)] };
}

/** The card (an index into the game's cards) that won the pair on screen. */
export const pick = (game: Game, winner: number): Game => answer(game, winner);

/** No answer: the pair is asked, nothing is learnt, the game moves on. */
export const skip = (game: Game): Game => answer(game, null);

export const canUndo = (game: Game): boolean => game.history.length > 0;

/**
 * The last answer taken back. Taken back past the first close call, the game
 * is no longer over and Refine is not used: its pairs would be other ones.
 */
export function undo(game: Game): Game {
  if (game.history.length === 0) return game;
  const history = game.history.slice(0, -1);
  const fixed = game.refineFixed;
  if (fixed === undefined || history.length >= fixed.from) return { ...game, history };
  const { refineFixed: _, ...rest } = game;
  return { ...rest, spec: { ...game.spec, refine: false }, history };
}

/** How many close calls Refine would ask; 0 once it is used, and before the game is over. */
export function refineCount(game: Game): number {
  if (game.refineFixed !== undefined || !isOver(game)) return 0;
  return refinePairs(game.spec.count, game.history).length;
}

/** The game, over, going on with its close calls; as it was when there are none. */
export function startRefine(game: Game): Game {
  if (game.refineFixed !== undefined || !isOver(game)) return game;
  const pairs = refinePairs(game.spec.count, game.history);
  if (pairs.length === 0) return game;
  return {
    ...game,
    spec: { ...game.spec, refine: true },
    refineFixed: { from: game.history.length, pairs },
  };
}

/** Where a game stands, for its header, its bar and its saved line. */
export interface GameProgress {
  phase: "main" | "refine";
  /** Answered so far in this phase, and how many it should take. */
  asked: number;
  total: number;
  /** Losers stay: the round being asked, of how many; null for the other games and once over. */
  round: { n: number; of: number } | null;
  /** The whole game: every answer so far, of every duel it should take. */
  overall: { asked: number; total: number };
}

export function gameProgress(game: Game): GameProgress {
  const fixed = game.refineFixed;
  if (fixed !== undefined) {
    const asked = game.history.length - fixed.from;
    const total = fixed.pairs.length;
    return {
      phase: "refine",
      asked,
      total,
      round: null,
      overall: { asked: game.history.length, total: fixed.from + total },
    };
  }
  const main = mainGame(game.spec, game.history);
  const overall = { asked: game.history.length, total: main.planned };
  return {
    phase: "main",
    ...overall,
    overall,
    round: main.round === undefined ? null : { n: main.round, of: swissRounds(game.spec.count) },
  };
}

/**
 * A bracket's round as it is being asked: how many cards are still in it,
 * byes included; null for the other games, during Refine, and once over. A
 * round of n cards asks ⌊n/2⌋ duels and sends ⌈n/2⌉ on, whatever the shuffle,
 * so the count alone says where the bracket stands.
 */
export function bracketRound(game: Game): number | null {
  if (game.spec.kind !== "bracket" || game.refineFixed !== undefined) return null;
  let left = game.history.length;
  let cards = game.spec.count;
  while (cards > 1) {
    const asked = Math.floor(cards / 2);
    if (left < asked) return cards;
    left -= asked;
    cards = Math.ceil(cards / 2);
  }
  return null;
}

/**
 * King of the hill: the card holding the hill and how many duels in a row it
 * has won, counted back from the last answer; a skip ends a run, since
 * nobody won it. Null for the other games, during Refine, and once over.
 */
export function hillStreak(game: Game): { champion: number; wins: number } | null {
  if (game.spec.kind !== "hill" || game.refineFixed !== undefined) return null;
  const pair = currentPair(game);
  if (pair === null) return null;
  const [champion] = pair;
  let wins = 0;
  for (let at = game.history.length - 1; at >= 0 && game.history[at]?.[2] === champion; at--) {
    wins++;
  }
  return { champion, wins };
}

/** Duels actually answered: skips asked nothing of anybody. */
export const answered = (game: Game): number => duels(game.history).length;

/**
 * Where the game leaves its cards: one row of ids per tier of the board, best
 * first, each best on the left. Cards kept in their tier fill that tier alone,
 * in order.
 */
export function resultOf(game: Game, board: PlayBoard): string[][] {
  const tierCount = Math.max(1, board.tiers.length);
  const idOf = (card: number): string => game.ids[card] ?? "";
  // A game drawn from a tier that is gone places nothing: never the whole board instead.
  if (lostTier(board, game.chosen)) return Array.from({ length: tierCount }, () => []);
  const kept = keptTier(board, game.chosen);
  if (kept !== null) {
    const rows: string[][] = Array.from({ length: tierCount }, () => []);
    rows[kept] = standing(game.spec.count, duels(game.history)).order.map(idOf);
    return rows;
  }
  return result(game.spec, game.history, tierCount).map((row) => row.map(idOf));
}

/** The cards that played fewer than SOLID_DUELS real duels: drawn dashed, and a guess. */
export function dashedIds(game: Game): Set<string> {
  const played = duelsPlayed(game.spec.count, game.history);
  return new Set(game.ids.filter((_, card) => (played[card] ?? 0) < SOLID_DUELS));
}

/** More than a quarter of the cards dashed: the result says it rests on little. */
export const isThinResult = (game: Game): boolean =>
  isThin({ played: duelsPlayed(game.spec.count, game.history) });

/** A duel takes about this long to answer, for the picker's estimate. */
const SECONDS_PER_DUEL = 2.2;

export interface Estimate {
  duels: number;
  minutes: number;
  /** Losers stay may end a round or two early: its count is an upper bound. */
  rough: boolean;
}

/**
 * What a game over `count` cards will ask: hill and bracket n − 1 (a bye is no
 * duel), losers stay R × ⌊n/2⌋ with R = ⌈log₂ n⌉ + 2; about 2.2 s a duel,
 * rounded to whole minutes, never under one.
 */
export function estimate(kind: GameKind, count: number): Estimate {
  const asked =
    kind === "swiss"
      ? swissRounds(Math.max(2, count)) * Math.floor(count / 2)
      : Math.max(0, count - 1);
  const minutes = Math.max(1, Math.round((asked * SECONDS_PER_DUEL) / 60));
  return { duels: asked, minutes, rough: kind === "swiss" };
}

/** A session always keeps the exact participant IDs with which it began. */
export type Resume = { kind: "ready" | "changed"; game: Game };

/** A card gone from the board, or a tier the game was drawn from: the board changed, start again. */
export function reconcile(game: Game, board: PlayBoard): Resume {
  const complete = game.ids.every((id) => board.cards.has(id)) && !lostTier(board, game.chosen);
  return { kind: complete ? "ready" : "changed", game };
}

export type Unplayed = "keep" | "pool";

/**
 * Whether "Not played" is a choice: a card of the game's ranked tiers sat it
 * out and the game re-tiers. A game in one tier keeps its unplayed cards
 * behind the played ones, and one in the pool leaves them where they are
 * (WIRE-SPEC rules 1, 2 and 5).
 */
export function unplayedMatters(game: Game, board: PlayBoard): boolean {
  if (keepsTier(game.chosen) !== null) return false;
  const area = areaOf(board, game.chosen);
  const played = new Set(game.ids);
  return board.tiers.some(
    (tier) => area.tiers.has(tier.id) && tier.cardIds.some((id) => !played.has(id)),
  );
}

/**
 * The board after a result: each tier's played cards first, as the result has
 * them, then the cards that sat out in the order they had. "To the pool"
 * takes only those of the game's own tiers there; a tier outside the game,
 * and the one tier a game orders, keep theirs (WIRE-SPEC rules 1 to 5).
 */
export function applied(
  board: PlayBoard,
  placed: readonly (readonly string[])[],
  game: Pick<Game, "ids" | "chosen">,
  unplayed: Unplayed = "keep",
): string[][] {
  const playing = new Set(game.ids);
  const area = areaOf(board, game.chosen);
  const pooling = unplayed === "pool" && keepsTier(game.chosen) === null;
  return board.tiers.map((tier, i) => [
    ...(placed[i] ?? []),
    ...(pooling && area.tiers.has(tier.id) ? [] : tier.cardIds.filter((id) => !playing.has(id))),
  ]);
}
