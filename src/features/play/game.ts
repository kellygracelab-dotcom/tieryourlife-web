import type { PlayBoard } from "./board";
import { chosenIds, keptTier, MAX_CARDS, MIN_CHOSEN, type Chosen } from "./chosen";
import {
  duels,
  duelsPlayed,
  isThin,
  nextPair,
  outcomeOf,
  progress,
  refinePairs,
  result,
  SOLID_DUELS,
  standing,
  swissRound,
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
  if (refineCount(game) === 0) return game;
  return {
    ...game,
    spec: { ...game.spec, refine: true },
    refineFixed: { from: game.history.length, pairs: refinePairs(game.spec.count, game.history) },
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
  const main = progress({ ...game.spec, refine: false }, game.history);
  const round = game.spec.kind === "swiss" ? swissRoundNow(game.spec.count, game.history) : null;
  return {
    phase: "main",
    ...main,
    round: round === null ? null : { n: round, of: swissRounds(game.spec.count) },
    overall: main,
  };
}

/**
 * The round the next answer belongs to, counted from 1, or null when the game
 * is over. The engine's own walk through the rounds (games.ts), kept to the
 * count: a round is the pairs found from the answers before it.
 */
function swissRoundNow(count: number, history: readonly Outcome[]): number | null {
  if (count < 2) return null;
  const rounds = swissRounds(count);
  let used = 0;
  for (let round = 0; round < rounds; round++) {
    const pairs = swissRound(count, history.slice(0, used));
    if (pairs.length === 0) return null;
    if (history.length - used < pairs.length) return round + 1;
    used += pairs.length;
  }
  return null;
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
  isThin(standing(game.spec.count, duels(game.history)));

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

/** How a saved game meets the board as it is now. */
export type Resume =
  /** Resumable; `joined` new cards came in (losers stay only). */
  | { kind: "ready"; game: Game; joined: number }
  /** The cards changed under a game that cannot take that, or too few are left: start over. */
  | { kind: "changed"; game: Game };

/**
 * A saved game against the board it was saved from, changed since or not.
 * Cards still on the board stay in the game wherever they moved.
 *
 * - Losers stay: answers with a card that left the board are dropped, the rest
 *   renumbered, and cards that are now in the chosen rows join at the end, up
 *   to 64 in all. The engine works its rounds out from the answers, so they
 *   come into the rounds still to be asked. Close calls start afresh.
 * - King of the hill and bracket: the order of the duels is the game, so any
 *   change means starting over.
 */
export function reconcile(game: Game, board: PlayBoard): Resume {
  const onBoard = new Set(board.order);
  const ids = new Set(game.ids);
  const kept = game.ids.filter((id) => onBoard.has(id));
  const newcomers =
    game.chosen.kind === "picked" ? [] : chosenIds(board, game.chosen).filter((id) => !ids.has(id));
  if (kept.length === game.ids.length && newcomers.length === 0) {
    return { kind: "ready", game, joined: 0 };
  }
  if (game.spec.kind !== "swiss") return { kind: "changed", game };
  const joining = newcomers.slice(0, Math.max(0, MAX_CARDS - kept.length));
  const next = [...kept, ...joining];
  if (next.length < MIN_CHOSEN) return { kind: "changed", game };
  const indexOf = new Map(next.map((id, index) => [id, index]));
  const renumber = (card: number): number | undefined => indexOf.get(game.ids[card] ?? "");
  const history = game.history.flatMap(([first, second, winner]): Outcome[] => {
    const a = renumber(first);
    const b = renumber(second);
    if (a === undefined || b === undefined) return [];
    return [[a, b, winner === null ? null : winner === first ? a : b]];
  });
  const { refineFixed: _, ...rest } = game;
  return {
    kind: "ready",
    game: {
      ...rest,
      spec: { ...game.spec, count: next.length, refine: false },
      ids: next,
      history,
    },
    joined: joining.length,
  };
}

/**
 * The board's tiers once a result is applied: the played cards take the places
 * the result gives them, every other card stays where it is. In each tier the
 * played cards go as one block, best first, where the first of them stood, or
 * at the end when none of them was there, as a card placed from the pool goes.
 * A card in no row is in the pool.
 */
export function applied(
  board: PlayBoard,
  placed: readonly (readonly string[])[],
  played: readonly string[],
): string[][] {
  const playing = new Set(played);
  return board.tiers.map((tier, index) => {
    const row = tier.cardIds;
    const block = placed[index] ?? [];
    const first = row.findIndex((id) => playing.has(id));
    const others = row.filter((id) => !playing.has(id));
    const at =
      first === -1 ? others.length : row.slice(0, first).filter((id) => !playing.has(id)).length;
    return [...others.slice(0, at), ...block, ...others.slice(at)];
  });
}
