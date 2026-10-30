/*
 * Play mode's engine, a port of the app's feature/play/domain: the same
 * answers give the same tiers on both platforms. docs/play-mode-spec.md in the
 * app's repository is the contract, and play-vectors.json here is its copy of
 * the shared vectors. Only numbers go in and out; the UI keeps the cards.
 */
export {
  duelOf,
  duels,
  duelsPlayed,
  goesOn,
  isOver,
  nextPair,
  outcomeOf,
  progress,
  refinePairs,
  result,
  swissRound,
  swissRounds,
  type GameKind,
  type GameProgress,
  type GameSpec,
  type Outcome,
  type Pair,
} from "./games";
export { Mulberry32, shuffled } from "./mulberry32";
export { duelsPerCard, standing, STRENGTH_ROUNDS, type Duel, type Standing } from "./strength";
export { isDashed, isThin, SOLID_DUELS, THIN_GROUPS, tiers } from "./tiers";
