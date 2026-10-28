import { at, increment, zeros } from "./arrays";
import { shuffled } from "./mulberry32";
import { standing, type Duel, type Standing } from "./strength";
import { isDashed, tiers } from "./tiers";

/**
 * - hill: the winner stays and meets the next card.
 * - bracket: pairs; winners go on until one is left.
 * - swiss: Swiss rounds; a lost duel knocks nobody out, cards with equal records meet.
 */
export type GameKind = "hill" | "bracket" | "swiss";

/** What a game is: which, over how many cards, from which shuffle, and whether close calls are asked at the end. */
export interface GameSpec {
  kind: GameKind;
  /** Cards are 0..count-1 in the board's own order, which breaks every tie. */
  count: number;
  /** A signed 32-bit integer. */
  seed: number;
  refine: boolean;
}

/** Two cards to show, first on the left. */
export type Pair = readonly [first: number, second: number];

/** One asked duel: the pair shown, and who won it, or null when it was skipped. */
export type Outcome = readonly [first: number, second: number, winner: number | null];

/** The answer to a pair the game asked, checked the way the app's Outcome checks itself. */
export function outcomeOf([first, second]: Pair, winner: number | null): Outcome {
  if (winner !== null && winner !== first && winner !== second) {
    throw new RangeError("The winner is one of the pair");
  }
  return [first, second, winner];
}

/** The answered duel, or null for a skip. */
export function duelOf([first, second, winner]: Outcome): Duel | null {
  return winner === null ? null : { winner, loser: winner === first ? second : first };
}

/** Who goes on when the game needs somebody to: a skip lets the card listed earlier through. */
export function goesOn([first, second, winner]: Outcome): number {
  return winner ?? Math.min(first, second);
}

/** Only answered duels count towards strength; a skip is no evidence either way. */
export function duels(history: readonly Outcome[]): Duel[] {
  return history.flatMap((outcome) => duelOf(outcome) ?? []);
}

/**
 * Real duels each card took part in, skips not counted: the standing's
 * `played` without the scoring, for a screen that marks a card under
 * SOLID_DUELS before the game is over.
 */
export function duelsPlayed(count: number, history: readonly Outcome[]): number[] {
  const played = zeros(count);
  for (const { winner, loser } of duels(history)) {
    increment(played, winner);
    increment(played, loser);
  }
  return played;
}

/**
 * The next pair to ask, or null when the game is over. A game is its spec and
 * its history alone: nothing else is kept, so it resumes anywhere, on either
 * platform, from the same answers.
 */
export function nextPair(spec: GameSpec, history: readonly Outcome[]): Pair | null {
  if (spec.count < 2) return null;
  const main = mainGame(spec, history);
  if (main.next !== null || !spec.refine) return main.next;
  const refining = history.length - main.used;
  return refinePairs(spec.count, history.slice(0, main.used))[refining] ?? null;
}

export function isOver(spec: GameSpec, history: readonly Outcome[]): boolean {
  return nextPair(spec, history) === null;
}

/** Duels asked so far, and how many the game should take in all. */
export interface GameProgress {
  asked: number;
  total: number;
}

/**
 * How far a game has come, for the screen; the app's engine has no such call
 * yet, so nothing shared depends on it. Hill and bracket know their length
 * from the start. Swiss counts the rounds still to come as full, and refine as
 * its most until its pairs are fixed, so the total only ever shrinks, and
 * equals what was asked once the game is over.
 */
export function progress(spec: GameSpec, history: readonly Outcome[]): GameProgress {
  const asked = history.length;
  if (spec.count < 2) return { asked, total: asked };
  const main = mainGame(spec, history);
  if (main.next !== null) {
    return { asked, total: main.planned + (spec.refine ? refineLimit(spec.count) : 0) };
  }
  if (!spec.refine) return { asked, total: asked };
  const refining = refinePairs(spec.count, history.slice(0, main.used)).length;
  return { asked, total: Math.max(asked, main.used + refining) };
}

/** How many duels the main game took, the next one if it is not over, and how many it should take in all. */
interface MainGame {
  used: number;
  next: Pair | null;
  planned: number;
}

function mainGame(spec: GameSpec, history: readonly Outcome[]): MainGame {
  switch (spec.kind) {
    case "hill":
      return hillPairs(spec, history);
    case "bracket":
      return bracketPairs(spec, history);
    case "swiss":
      return swissPairs(spec, history);
  }
}

function hillPairs(spec: GameSpec, history: readonly Outcome[]): MainGame {
  const order = shuffled(spec.count, spec.seed);
  let champion = at(order, 0);
  let challenger = 1;
  for (const outcome of history) {
    if (challenger >= order.length) break;
    champion = goesOn(outcome);
    challenger++;
  }
  const next: Pair | null = challenger < order.length ? [champion, at(order, challenger)] : null;
  return { used: challenger - 1, next, planned: order.length - 1 };
}

function bracketPairs(spec: GameSpec, history: readonly Outcome[]): MainGame {
  const planned = spec.count - 1;
  let round = shuffled(spec.count, spec.seed);
  let used = 0;
  while (round.length > 1) {
    const onward: number[] = [];
    for (let place = 0; place < round.length - 1; place += 2) {
      const outcome = history[used];
      if (outcome === undefined) {
        return { used, next: [at(round, place), at(round, place + 1)], planned };
      }
      onward.push(goesOn(outcome));
      used++;
    }
    // The bye goes on last.
    if (round.length % 2 === 1) onward.push(at(round, round.length - 1));
    round = onward;
  }
  return { used, next: null, planned };
}

const EXTRA_SWISS_ROUNDS = 2;

/** ceil(log2 n) + 2 rounds, counted in integers: the smallest r with 2^r >= n, plus two. */
export function swissRounds(count: number): number {
  return 32 - Math.clz32(count - 1) + EXTRA_SWISS_ROUNDS;
}

function swissPairs(spec: GameSpec, history: readonly Outcome[]): MainGame {
  const rounds = swissRounds(spec.count);
  let used = 0;
  for (let round = 0; round < rounds; round++) {
    const pairs = swissRound(spec.count, history.slice(0, used));
    if (pairs.length === 0) break;
    const answered = Math.min(pairs.length, history.length - used);
    const next = pairs[answered];
    if (next !== undefined) {
      const fullRound = Math.floor(spec.count / 2);
      const planned = used + pairs.length + (rounds - round - 1) * fullRound;
      return { used: used + answered, next, planned };
    }
    used += answered;
  }
  return { used, next: null, planned: used };
}

/** Whether two cards were ever shown together, skips included. */
type Met = (a: number, b: number) => boolean;

function meetings(count: number, history: readonly Outcome[]): Met {
  const met = new Set<number>();
  for (const [first, second] of history) {
    met.add(first * count + second);
    met.add(second * count + first);
  }
  return (a, b) => met.has(a * count + b);
}

/**
 * One round's pairs: by wins so far, then original order; each card meets the
 * next free card it has not met. A card left without one sits the round out.
 */
export function swissRound(count: number, history: readonly Outcome[]): Pair[] {
  const wins = zeros(count);
  for (const [, , winner] of history) if (winner !== null) increment(wins, winner);
  const met = meetings(count, history);
  const standings = Array.from({ length: count }, (_, card) => card).sort(
    (a, b) => at(wins, b) - at(wins, a) || a - b,
  );
  const paired = new Set<number>();
  const pairs: Pair[] = [];
  standings.forEach((card, place) => {
    if (paired.has(card)) return;
    const partner = standings
      .slice(place + 1)
      .find((other) => !paired.has(other) && !met(card, other));
    if (partner === undefined) return;
    paired.add(card);
    paired.add(partner);
    pairs.push([card, partner]);
  });
  return pairs;
}

const refineLimit = (count: number): number => Math.ceil(count / 2);

/**
 * Close calls after the game, at most half the cards' worth, each card at most
 * once. First every dashed card, best first, meets its nearest free neighbour
 * it has not met, the smaller gap in strength winning and the better-placed on
 * a tie; then neighbours in the standing whose order is least sure, closest
 * first. Pairs are always better-placed first.
 */
export function refinePairs(count: number, history: readonly Outcome[]): Pair[] {
  const scored = standing(count, duels(history));
  const met = meetings(count, history);
  const picker = new PairPicker(count);
  scored.order.forEach((card, place) => {
    if (!isDashed(scored, card) || !picker.isFree(card)) return;
    const pair = nearestPartner(scored, place, met, picker);
    if (pair !== null) picker.take(pair);
  });
  for (const pair of closeCalls(scored, met)) picker.take(pair);
  return picker.picked;
}

/** Each card at most once, at most half the cards' worth of pairs. */
class PairPicker {
  readonly picked: Pair[] = [];
  private readonly used = new Set<number>();
  private readonly limit: number;

  constructor(count: number) {
    this.limit = refineLimit(count);
  }

  isFree(card: number): boolean {
    return !this.used.has(card);
  }

  take(pair: Pair): void {
    const [first, second] = pair;
    if (this.picked.length < this.limit && this.isFree(first) && this.isFree(second)) {
      this.used.add(first);
      this.used.add(second);
      this.picked.push(pair);
    }
  }
}

/** The free card next to the one at `place` that it has not met, above or below, whichever is closer in strength. */
function nearestPartner(
  scored: Standing,
  place: number,
  met: Met,
  picker: PairPicker,
): Pair | null {
  const { order, logStrength } = scored;
  const card = at(order, place);
  const open = (other: number) => picker.isFree(other) && !met(card, other);
  const above = order.slice(0, place).findLast(open);
  const below = order.slice(place + 1).find(open);
  const strength = at(logStrength, card);
  const upGap = above === undefined ? Infinity : at(logStrength, above) - strength;
  const downGap = below === undefined ? Infinity : strength - at(logStrength, below);
  if (above !== undefined && upGap <= downGap) return [above, card];
  if (below !== undefined) return [card, below];
  return null;
}

/** Neighbours in the standing who have not met, the least sure order first. */
function closeCalls(scored: Standing, met: Met): Pair[] {
  const { order, logStrength } = scored;
  return order
    .slice(1)
    .map((second, place) => {
      const first = at(order, place);
      const gap = at(logStrength, first) - at(logStrength, second);
      return { pair: [first, second] as const, place, gap };
    })
    .filter(({ pair: [first, second] }) => !met(first, second))
    .sort((a, b) => a.gap - b.gap || a.place - b.place)
    .map(({ pair }) => pair);
}

/** Where a game leaves its cards: tiers best first, each best on the left. */
export function result(spec: GameSpec, history: readonly Outcome[], tierCount: number): number[][] {
  return tiers(standing(spec.count, duels(history)), tierCount);
}
