import { at, zeros } from "./arrays";
import { duelsPerCard, type Standing } from "./strength";

/** Groups are accepted once they explain this much of the spread. */
export const ENOUGH_FIT = 0.9;

/** Below this many answered duels per card the evidence is thin: at most THIN_GROUPS groups, and a card shows dashed. */
export const SOLID_DUELS = 2;

export const THIN_GROUPS = 3;

/** More than one card in this many dashed makes the whole result thin. */
const QUARTERS = 4;

/** A card that met fewer than SOLID_DUELS others is drawn dashed in the result. */
export function isDashed(standing: Standing, card: number): boolean {
  return at(standing.played, card) < SOLID_DUELS;
}

/**
 * The result says it rests on little: more than a quarter of the cards dashed.
 * An empty tier between filled ones is not thin; it is the tiering showing a
 * real gap.
 */
export function isThin(standing: Standing): boolean {
  const dashed = standing.played.filter((_, card) => isDashed(standing, card)).length;
  return dashed * QUARTERS > standing.played.length;
}

/** How many groups the evidence allows: thin evidence claims no more than THIN_GROUPS. */
export function groupLimit(standing: Standing, fits: number): number {
  return duelsPerCard(standing) < SOLID_DUELS ? Math.min(fits, THIN_GROUPS) : fits;
}

/**
 * Cards cut into `tierCount` tiers, best first, each tier left to right from
 * best. As few groups as explain the spread (Jenks's goodness of variance fit),
 * and each group goes to the tier its strength points at, so a real gap leaves
 * the tiers in between empty and the weakest still land low. Only the first
 * tier is sure to be filled.
 */
export function tiers(standing: Standing, tierCount: number): number[][] {
  if (tierCount < 1) throw new RangeError("A board has at least one tier");
  const result: number[][] = Array.from({ length: tierCount }, () => []);
  const { order } = standing;
  const values = order.map((card) => at(standing.logStrength, card));
  const top = values[0] ?? 0;
  const bottom = values[values.length - 1] ?? 0;
  if (tierCount === 1 || top === bottom) {
    at(result, 0).push(...order);
    return result;
  }
  const scaled = values.map((value) => (value - bottom) / (top - bottom));
  const groups = groupsOf(scaled, groupLimit(standing, Math.min(tierCount, scaled.length)));
  let previous = -1;
  const placed = groups.map((group, index) => {
    let sum = 0;
    for (let place = group.from; place <= group.to; place++) sum += at(scaled, place);
    const mean = sum / (group.to - group.from + 1);
    const aimed = Math.floor((1 - mean) * (tierCount - 1) + 0.5);
    const tier = index === 0 ? 0 : Math.max(aimed, previous + 1);
    previous = tier;
    return tier;
  });
  // From the last group back, so every group still fits below the one before.
  for (let index = placed.length - 1; index >= 0; index--) {
    placed[index] = Math.min(at(placed, index), tierCount - groups.length + index);
  }
  groups.forEach((group, index) => {
    const tier = at(result, at(placed, index));
    for (let place = group.from; place <= group.to; place++) tier.push(at(order, place));
  });
  return result;
}

/** Consecutive places in the order, both ends included. */
export interface Group {
  from: number;
  to: number;
}

/**
 * The fewest groups of consecutive values whose fit reaches ENOUGH_FIT, at
 * most `maxGroups`, or `maxGroups` when none does. Fisher's exact method;
 * among equal splits the earliest wins, so both platforms pick the same one.
 */
export function groupsOf(values: readonly number[], maxGroups: number): Group[] {
  const n = values.length;
  const sums = [0];
  const squares = [0];
  values.forEach((value, i) => {
    sums.push(at(sums, i) + value);
    squares.push(at(squares, i) + value * value);
  });
  const spread = (from: number, to: number): number => {
    const size = to - from + 1;
    const sum = at(sums, to + 1) - at(sums, from);
    return Math.max(0, at(squares, to + 1) - at(squares, from) - (sum * sum) / size);
  };
  const total = spread(0, n - 1);
  const cost = Array.from({ length: maxGroups + 1 }, () => zeros(n));
  const start = Array.from({ length: maxGroups + 1 }, () => zeros(n));
  for (let i = 0; i < n; i++) at(cost, 1)[i] = spread(0, i);
  for (let groups = 2; groups <= maxGroups; groups++) {
    const fewer = at(cost, groups - 1);
    for (let i = groups - 1; i < n; i++) {
      let best = Number.MAX_VALUE;
      let bestStart = groups - 1;
      for (let s = groups - 1; s <= i; s++) {
        const candidate = at(fewer, s - 1) + spread(s, i);
        if (candidate < best) {
          best = candidate;
          bestStart = s;
        }
      }
      at(cost, groups)[i] = best;
      at(start, groups)[i] = bestStart;
    }
  }
  let chosen = maxGroups;
  for (let groups = 1; groups <= maxGroups; groups++) {
    if (total === 0 || 1 - at(at(cost, groups), n - 1) / total >= ENOUGH_FIT) {
      chosen = groups;
      break;
    }
  }
  const ranges: Group[] = [];
  let end = n - 1;
  for (let groups = chosen; groups >= 1; groups--) {
    const from = groups === 1 ? 0 : at(at(start, groups), end);
    ranges.unshift({ from, to: end });
    end = from - 1;
  }
  return ranges;
}
