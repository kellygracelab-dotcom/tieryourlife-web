import type { SyncedPlay } from "../../api/boards";
import type { Chosen } from "./chosen";
import { mainGame, refinePairs, type Outcome } from "./engine";
import type { Game } from "./game";
import { EXPIRES_AFTER, type SavedGames } from "./savedGames";

/**
 * A game of one's own board kept in the board itself, and only there, so the
 * account carries it to the phone and back and a game finished on one device
 * is gone on the other (no copy of this device's can bring it back): the app's field names (SyncedPlay), in the normal
 * form the backend keeps, so a round trip leaves the board's fingerprint as it
 * was.
 *
 * What only this site keeps is worked out again on the way back: where Refine
 * began is where the main game ends, and its pairs follow from the answers
 * before it (refinePairs is the same on both sides).
 */
export function toSynced(game: Game, poolId: string | null, now: number): SyncedPlay {
  const chosen = game.chosen.kind === "sample" ? game.chosen.source : game.chosen;
  const scope = scopeOf(chosen, poolId);
  const keepTier = chosen.kind !== "all" && chosen.keepTier && scope?.length === 1;
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
  const from = mainGame(spec, history).used;
  return {
    ...game,
    spec: { ...spec, refine: true },
    refineFixed: { from, pairs: refinePairs(play.count, history.slice(0, from)) },
  };
}

function scopeOf(
  chosen: Exclude<Chosen, { kind: "sample" }>,
  poolId: string | null,
): string[] | null {
  if (chosen.kind === "all") return null;
  const tiers =
    chosen.kind === "rows"
      ? [...chosen.tiers, ...(chosen.pool && poolId !== null ? [poolId] : [])]
      : [chosen.tier ?? poolId].filter((id): id is string => id !== null);
  return tiers.length === 0 ? null : tiers;
}

/**
 * The synced form has no word for cards picked one by one: they travel as
 * their row, and the game's own cards say which. One row comes back as those
 * cards, picked, so a reload never pulls in the rest of the row as cards that
 * joined the game; a game over a whole row was all of its cards anyway, and
 * only a card added to that row since is left out of it.
 */
function chosenOf(play: SyncedPlay, poolId: string | null): Chosen {
  if (play.scope === undefined || play.scope.length === 0) return { kind: "all" };
  const [row] = play.scope;
  if (play.scope.length === 1 && row !== undefined) {
    const tier = row === poolId ? null : row;
    return {
      kind: "picked",
      tier,
      ids: [...play.ids],
      keepTier: tier !== null && play.keepTier === true,
    };
  }
  return {
    kind: "rows",
    tiers: play.scope.filter((id) => id !== poolId),
    pool: poolId !== null && play.scope.includes(poolId),
    keepTier: play.keepTier === true,
  };
}

function roundOf(game: Game): number {
  if (game.spec.kind !== "swiss" || game.refineFixed !== undefined) return 0;
  return mainGame(game.spec, game.history).round ?? 0;
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
      if (play === null) return null;
      // Thirty days from its start, as the phone counts; the backend counts
      // from the last write, so a late copy there is gone soon after.
      if (now() - play.startedAt > EXPIRES_AFTER) {
        write(null);
        return null;
      }
      return fromSynced(play, poolId);
    },
    save: (_key, game) => write(toSynced(game, poolId, now())),
    discard: () => write(null),
  };
}
