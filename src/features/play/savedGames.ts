import type { KeyValueStore } from "../../lib/storage";
import { MAX_CARDS, type Chosen } from "./chosen";
import type { GameKind, Outcome, Pair } from "./engine";
import type { Game } from "./game";

/**
 * Where a board's game in progress is kept between visits: one per board, on
 * this device, at `play:{boardKey}`, for 30 days after it was last played.
 *
 * The account copy comes later: the synced board document gets a `play` field
 * holding `encodeGame`'s text, and an account-backed `SavedGames` writes both
 * places and reads the newer one. Pages hand that one to `usePlay` instead of
 * this device's; nothing else changes.
 */
export interface SavedGames {
  load(boardKey: string): Game | null;
  save(boardKey: string, game: Game): void;
  discard(boardKey: string): void;
}

const DAY = 24 * 60 * 60 * 1000;

/** A saved game left alone this long is gone, silently. */
export const EXPIRES_AFTER = 30 * DAY;

export const playKey = (boardKey: string): string => `play:${boardKey}`;

/** The text a saved game is kept as, here and later in the account. */
export function encodeGame(game: Game, savedAt: number): string {
  return JSON.stringify({ version: 1, savedAt, game });
}

/** A saved game, or null for anything that is not one: a stored text is checked, not trusted. */
export function decodeGame(text: string): { game: Game; savedAt: number } | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.version !== 1 || !isNumber(value.savedAt)) return null;
    const game = gameOf(value.game);
    return game === null ? null : { game, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

export function localGames(store: KeyValueStore, now: () => number = Date.now): SavedGames {
  return {
    load(boardKey) {
      const text = store.read(playKey(boardKey));
      if (text === null) return null;
      const saved = decodeGame(text);
      if (saved === null || now() - saved.savedAt > EXPIRES_AFTER) {
        store.remove(playKey(boardKey));
        return null;
      }
      return saved.game;
    },
    save: (boardKey, game) => store.write(playKey(boardKey), encodeGame(game, now())),
    discard: (boardKey) => store.remove(playKey(boardKey)),
  };
}

/** The game this device last started, which the picker offers first. */
export const LAST_GAME_KEY = "tyl:playGame";

const KINDS: readonly GameKind[] = ["swiss", "hill", "bracket"];

const isKind = (value: unknown): value is GameKind => KINDS.some((kind) => kind === value);

export function lastGame(store: KeyValueStore): GameKind {
  const kind = store.read(LAST_GAME_KEY);
  return isKind(kind) ? kind : "swiss";
}

export const rememberGame = (store: KeyValueStore, kind: GameKind): void =>
  store.write(LAST_GAME_KEY, kind);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isInteger = (value: unknown): value is number => isNumber(value) && Number.isInteger(value);

const isIndex = (value: unknown, count: number): value is number =>
  isInteger(value) && value >= 0 && value < count;

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Each item read by `read`, or null when any is not what it should be. */
function every<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const one = read(item);
    if (one === null) return null;
    items.push(one);
  }
  return items;
}

function outcomeOf(value: unknown, count: number): Outcome | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [first, second, winner]: unknown[] = value;
  if (!isIndex(first, count) || !isIndex(second, count) || first === second) return null;
  if (winner === null) return [first, second, null];
  return winner === first || winner === second ? [first, second, winner] : null;
}

function pairOf(value: unknown, count: number): Pair | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [first, second]: unknown[] = value;
  return isIndex(first, count) && isIndex(second, count) && first !== second
    ? [first, second]
    : null;
}

function chosenOf(value: unknown): Chosen | null {
  if (!isRecord(value)) return null;
  if (value.kind === "all") return { kind: "all" };
  const keepTier = value.keepTier === true;
  if (value.kind === "rows" && isStrings(value.tiers) && typeof value.pool === "boolean") {
    return { kind: "rows", tiers: value.tiers, pool: value.pool, keepTier };
  }
  if (
    value.kind === "picked" &&
    (value.tier === null || typeof value.tier === "string") &&
    isStrings(value.ids)
  ) {
    return { kind: "picked", tier: value.tier, ids: value.ids, keepTier };
  }
  return null;
}

function refineOf(value: unknown, count: number, asked: number): Game["refineFixed"] | null {
  if (!isRecord(value) || !isInteger(value.from) || value.from > asked) return null;
  const pairs = every(value.pairs, (pair) => pairOf(pair, count));
  return pairs === null ? null : { from: value.from, pairs };
}

function gameOf(value: unknown): Game | null {
  if (!isRecord(value) || !isRecord(value.spec)) return null;
  const { kind, count, seed, refine } = value.spec;
  if (!isKind(kind) || !isInteger(seed) || typeof refine !== "boolean") return null;
  if (!isInteger(count) || count < 2 || count > MAX_CARDS) return null;
  if (!isStrings(value.ids) || value.ids.length !== count || !isNumber(value.startedAt))
    return null;
  const history = every(value.history, (outcome) => outcomeOf(outcome, count));
  const chosen = chosenOf(value.chosen);
  if (history === null || chosen === null) return null;
  const game: Game = {
    spec: { kind, count, seed, refine },
    ids: value.ids,
    history,
    startedAt: value.startedAt,
    chosen,
  };
  if (value.refineFixed === undefined) return game;
  const refineFixed = refineOf(value.refineFixed, count, history.length);
  return refineFixed === null ? null : { ...game, refineFixed };
}
