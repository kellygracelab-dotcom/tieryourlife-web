import type { SyncedPlay } from "../../api/boards";
import type { Chosen } from "./chosen";
import { isOver, refinePairs, swissRound, swissRounds, type Outcome } from "./engine";
import type { Game } from "./game";
import type { SavedGames } from "./savedGames";

/**
 * A game of one's own board kept in the board itself, so the account carries
 * it to the phone and back: the app's field names (SyncedPlay), in the normal
 * form the backend keeps, so a round trip leaves the board's fingerprint as it
 * was.
 *
 * What only this site keeps is worked out again on the way back: where Refine
 * began is where the main game ends, and its pairs follow from the answers
 * before it (refinePairs is the same on both sides).
 */
export function toSynced(game: Game, poolId: string | null, now: number): SyncedPlay {
  const scope = scopeOf(game.chosen, poolId);
  const keepTier = game.chosen.kind !== "all" && game.chosen.keepTier && scope?.length === 1;
  return {
    kind: game.spec.kind,
    count: game.spec.count,
    seed: game.spec.seed,
    refine: game.refineFixed !== undefined,
    ids: [...game.ids],
    history: game.history.map(([first, second, winner]) => [first, second, winner]),
    round: roundOf(game),
    startedAt: Math.min(game.startedAt, now),
    ...(scope === null ? {} : { scope }),
    ...(keepTier ? { keepTier: true as const } : {}),
  };
}

export function fromSynced(play: SyncedPlay, poolId: string | null): Game {
  const spec = { kind: play.kind, count: play.count, seed: play.seed, refine: false };
  const history: Outcome[] = play.history.map(([first, second, winner]) => [first, second, winner]);
  const game: Game = {
    spec,
    ids: [...play.ids],
    history,
    startedAt: play.startedAt,
    chosen: chosenOf(play, poolId),
  };
  if (!play.refine) return game;
  const from = mainLength(spec, history);
  return {
    ...game,
    spec: { ...spec, refine: true },
    refineFixed: { from, pairs: refinePairs(play.count, history.slice(0, from)) },
  };
}

function scopeOf(chosen: Chosen, poolId: string | null): string[] | null {
  if (chosen.kind === "all") return null;
  const tiers =
    chosen.kind === "rows"
      ? [...chosen.tiers, ...(chosen.pool && poolId !== null ? [poolId] : [])]
      : [chosen.tier ?? poolId].filter((id): id is string => id !== null);
  return tiers.length === 0 ? null : tiers;
}

function chosenOf(play: SyncedPlay, poolId: string | null): Chosen {
  if (play.scope === undefined || play.scope.length === 0) return { kind: "all" };
  return {
    kind: "rows",
    tiers: play.scope.filter((id) => id !== poolId),
    pool: poolId !== null && play.scope.includes(poolId),
    keepTier: play.keepTier === true,
  };
}

/** How many answers the main game took: the rest of a history are Refine's. */
function mainLength(
  spec: { kind: Game["spec"]["kind"]; count: number; seed: number },
  history: readonly Outcome[],
): number {
  const main = { ...spec, refine: false };
  for (let length = 0; length <= history.length; length++) {
    if (isOver(main, history.slice(0, length))) return length;
  }
  return history.length;
}

/** The Swiss rounds answered whole, as the app counts "the round reached"; 0 for the other games. */
function roundOf(game: Game): number {
  if (game.spec.kind !== "swiss") return 0;
  const rounds = swissRounds(game.spec.count);
  const answers = game.history.slice(0, game.refineFixed?.from ?? game.history.length);
  let used = 0;
  for (let round = 0; round < rounds; round++) {
    const pairs = swissRound(game.spec.count, answers.slice(0, used));
    if (pairs.length === 0 || answers.length - used < pairs.length) return round;
    used += pairs.length;
  }
  return rounds;
}

/** A board's own game, read from and written to the board: the page hands `usePlay` this. */
export function boardGames(
  read: () => SyncedPlay | null,
  write: (play: SyncedPlay | null) => void,
  poolId: string | null,
  now: () => number = Date.now,
): SavedGames {
  return {
    load: () => {
      const play = read();
      return play === null ? null : fromSynced(play, poolId);
    },
    save: (_key, game) => write(toSynced(game, poolId, now())),
    discard: () => write(null),
  };
}
