import { at, increment, zeros } from "./arrays";

/** A duel that was answered. Cards are indices into the game's cards, in their original order. */
export interface Duel {
  winner: number;
  loser: number;
}

/** Cards from best to worst, with what put them there. */
export interface Standing {
  /** Card indices, best first. */
  order: number[];
  /** Per card index: the log of its Bradley–Terry strength, rounded to nine places. */
  logStrength: number[];
  /** Per card index: duels actually won. */
  wins: number[];
  /** Per card index: duels actually played, skips not counted. */
  played: number[];
}

export const STRENGTH_ROUNDS = 200;

/**
 * Bradley–Terry by Hunter's MM steps, every card updated from the previous
 * round's values at once, so the order cards are listed in changes nothing.
 * Each card also plays a fixed reference card of strength 1 once each way: an
 * unbeaten card stays finite and a card nobody met sits at 1.
 *
 * A fixed round count and sums in index order, because the app must reach the
 * same bits: V8's `Math.log` is fdlibm, as the app's `StrictMath.log` is, and
 * both round the same nine places.
 */
export function standing(count: number, duels: readonly Duel[]): Standing {
  const met = Array.from({ length: count }, () => zeros(count));
  const wins = zeros(count);
  const played = zeros(count);
  for (const { winner, loser } of duels) {
    increment(at(met, winner), loser);
    increment(at(met, loser), winner);
    increment(wins, winner);
    increment(played, winner);
    increment(played, loser);
  }
  let strength = new Array<number>(count).fill(1);
  for (let round = 0; round < STRENGTH_ROUNDS; round++) {
    const previous = strength;
    strength = previous.map((own, i) => {
      const meetings = at(met, i);
      let denominator = 0;
      for (let j = 0; j < count; j++) {
        const times = at(meetings, j);
        if (j !== i && times > 0) denominator += times / (own + at(previous, j));
      }
      denominator += 2 / (own + 1);
      return (at(wins, i) + 1) / denominator;
    });
  }
  const logStrength = strength.map((value) => roundNine(Math.log(value)));
  const order = Array.from({ length: count }, (_, card) => card).sort(
    (a, b) => at(logStrength, b) - at(logStrength, a) || at(wins, b) - at(wins, a) || a - b,
  );
  return { order, logStrength, wins, played };
}

/** Answered duels per card, each duel counted for both its cards. */
export function duelsPerCard(scored: Standing): number {
  const { played } = scored;
  return played.length === 0 ? 0 : played.reduce((sum, duels) => sum + duels, 0) / played.length;
}

export function roundNine(value: number): number {
  return Math.floor(value * 1e9 + 0.5) / 1e9;
}
