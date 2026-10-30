import { fill, plural, strings } from "../../strings";
import type { GameKind } from "./engine";
import {
  bracketRound,
  estimate,
  gameProgress,
  hillStreak,
  type Game,
  type GameProgress,
} from "./game";

/** A game's name, as the picker, the header and the saved line say it. */
export const gameName = (kind: GameKind): string => strings.play[kind];

/** "≈ 136 duels · about 5 min": losers stay is an upper bound, the others exact. */
export function estimateText(kind: GameKind, count: number): string {
  const { duels, minutes, rough } = estimate(kind, count);
  return fill(rough ? strings.play.estimateRough : strings.play.estimate, {
    duels: plural(strings.play.duels, duels),
    time: plural(strings.play.minutes, minutes),
  });
}

/** "Duel 12 of 136", or "Refine · 4 of 17": the duel being asked, counted from one. */
export function duelText(progress: GameProgress): string {
  const n = Math.min(progress.asked + 1, Math.max(progress.total, 1));
  const template = progress.phase === "refine" ? strings.play.refineOf : strings.play.duelOf;
  return fill(template, { n, total: progress.total });
}

/** "Round 3 of 8", for losers stay while it runs. */
export const roundText = (progress: GameProgress): string | null =>
  progress.round === null
    ? null
    : fill(strings.play.roundOf, { n: progress.round.n, total: progress.round.of });

/**
 * A bracket's round by the cards in it, as a tournament names it: the final,
 * the semi-finals, the quarter-finals, then "Round of 16" and up. A round
 * with byes takes the name of the full one it fits in: 5 cards are the
 * quarter-finals.
 */
export function bracketRoundText(cards: number): string {
  let n = 2;
  while (n < cards) n *= 2;
  if (n === 2) return strings.play.final;
  if (n === 4) return strings.play.semiFinals;
  if (n === 8) return strings.play.quarterFinals;
  return fill(strings.play.roundOfLast, { n });
}

/** A hill's run worth saying: two wins and more. */
const STREAK_FROM = 2;

/**
 * The header's second line, the game's own character: losers stay's round,
 * a bracket's round by name, the card that holds the hill and its run. The
 * game's name where there is nothing more to say.
 */
export function secondLine(game: Game, nameOf: (card: number) => string): string {
  const name = gameName(game.spec.kind);
  const progress = gameProgress(game);
  const round = roundText(progress);
  if (round !== null) return `${name} · ${round}`;
  const cards = bracketRound(game);
  if (cards !== null) return bracketRoundText(cards);
  const streak = hillStreak(game);
  if (streak !== null && streak.wins >= STREAK_FROM) {
    return fill(plural(strings.play.streak, streak.wins), { name: nameOf(streak.champion) });
  }
  return name;
}

const DAY = 24 * 60 * 60 * 1000;

/** The calendar day a moment falls on, where the reader is. */
const dayOf = (time: number): number => {
  const date = new Date(time);
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
};

/** "Started yesterday": by the reader's calendar, not by 24-hour spans. */
export function startedText(startedAt: number, now: number): string {
  const days = dayOf(now) - dayOf(startedAt);
  if (days <= 0) return strings.play.startedToday;
  if (days === 1) return strings.play.startedYesterday;
  return plural(strings.play.startedDaysAgo, days);
}

/**
 * The thin banner's words: how many cards are a guess, then what Refine would
 * add for them, or only "apply and adjust" once Refine is used. Two counts,
 * so two plurals; "for it" when the guess is one card.
 */
export function thinText(dashed: number, refine: number): string {
  const cards = plural(strings.play.thinCards, dashed);
  if (refine === 0) return `${cards} ${strings.play.thinByHand}`;
  const more = plural(dashed === 1 ? strings.play.thinRefineIt : strings.play.thinRefine, refine);
  return `${cards} ${more}`;
}
