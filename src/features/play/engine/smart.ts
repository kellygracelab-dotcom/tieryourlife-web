import { at } from "./arrays";
import type { Standing } from "./strength";
import { tiers } from "./tiers";

/*
 * Smart (Danylo, 15.11.2026): Losers stay's first rounds, then only the
 * pairs that can still move a card across a tier's edge. A game is still its
 * spec and its answers alone; the app repeats every step below bit for bit,
 * and play-vectors.json holds the cases both must reach. The numbers below
 * were chosen on the simulation in smart-pairs-2026-11-15/simulation.md.
 */

/** Two cards to show, better placed first. */
type Pair = readonly [first: number, second: number];
type Met = (a: number, b: number) => boolean;

/** Losers stay's rounds before the edges. */
export const SMART_OPENING = 2;

/**
 * A card is contested at an edge while it stands closer to it than this many
 * of its standard errors, the error of a log-strength after `played` duels
 * taken as 2/√(played + 2), the reference card's two duels counted.
 */
export const SMART_MARGIN = 0.25;

/** Below this many answered duels a card is contested wherever it stands. */
export const SMART_UNSETTLED = 3;

/** From this many answered duels a card is no longer contested anywhere. */
export const SMART_MOST = 8;

/** Each card's tier, by index, from a standing cut into `tierCount`. */
export function tierOfCards(scored: Standing, tierCount: number): number[] {
  const tierOf = new Array<number>(scored.order.length).fill(0);
  tiers(scored, tierCount).forEach((row, tier) => {
    for (const card of row) tierOf[card] = tier;
  });
  return tierOf;
}

/**
 * One batch of pairs across the tiers' edges, each card at most once.
 *
 * The standing is cut into `tierCount` tiers as the result is. Each edge
 * between two filled tiers, best first, sits halfway in log-strength between
 * the last card above it and the first below. A card of either tier is
 * contested at that edge when it has played fewer than SMART_UNSETTLED duels,
 * or fewer than SMART_MOST and stands closer to the edge than SMART_MARGIN of
 * its standard errors; `closeness` is that distance in standard errors. A
 * card next to two edges is weighed at each.
 *
 * All contested entries are taken closest first, the better placed card on a
 * tie, then the earlier edge. A card not yet paired meets the card across its
 * edge, not yet paired and never shown with it, nearest in log-strength, the
 * better placed on a tie. The pair is better placed first.
 */
export function edgePairs(scored: Standing, tierCount: number, met: Met): Pair[] {
  const { order, logStrength, played } = scored;
  const place = new Array<number>(order.length).fill(0);
  order.forEach((card, index) => (place[card] = index));
  const rows = tiers(scored, tierCount).filter((row) => row.length > 0);
  const contested: { card: number; edge: number; across: readonly number[]; closeness: number }[] =
    [];
  for (let edge = 0; edge + 1 < rows.length; edge++) {
    const above = at(rows, edge);
    const below = at(rows, edge + 1);
    const line = (at(logStrength, at(above, above.length - 1)) + at(logStrength, at(below, 0))) / 2;
    const weigh = (card: number, across: readonly number[]) => {
      const duels = at(played, card);
      const closeness = (Math.abs(at(logStrength, card) - line) * Math.sqrt(duels + 2)) / 2;
      if (duels < SMART_UNSETTLED || (duels < SMART_MOST && closeness < SMART_MARGIN)) {
        contested.push({ card, edge, across, closeness });
      }
    };
    for (const card of above) weigh(card, below);
    for (const card of below) weigh(card, above);
  }
  contested.sort(
    (a, b) => a.closeness - b.closeness || at(place, a.card) - at(place, b.card) || a.edge - b.edge,
  );
  const taken = new Set<number>();
  const pairs: Pair[] = [];
  for (const { card, across } of contested) {
    if (taken.has(card)) continue;
    const strength = at(logStrength, card);
    let partner = -1;
    let gap = Infinity;
    for (const other of across) {
      if (taken.has(other) || met(card, other)) continue;
      const distance = Math.abs(at(logStrength, other) - strength);
      if (distance < gap || (distance === gap && at(place, other) < at(place, partner))) {
        partner = other;
        gap = distance;
      }
    }
    if (partner === -1) continue;
    taken.add(card);
    taken.add(partner);
    pairs.push(at(place, card) < at(place, partner) ? [card, partner] : [partner, card]);
  }
  return pairs;
}
