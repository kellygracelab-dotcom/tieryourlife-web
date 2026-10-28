import { describe, expect, it } from "vitest";
import {
  duels,
  isThin,
  Mulberry32,
  nextPair,
  result,
  shuffled,
  standing,
  tiers,
  type GameKind,
  type GameSpec,
  type Outcome,
} from "./index";
import { refinePairs } from "./games";
import vectorsText from "./play-vectors.json?raw";

/*
 * The app's docs/play-vectors.json, copied byte for byte: the app's
 * SharedVectorsTest checks the same file. When the app regenerates it, copy
 * it again; a vector that fails here is a tier the two platforms disagree on.
 */
interface Vectors {
  version: number;
  mulberry32: { seed: number; first: number[] }[];
  shuffle: { count: number; seed: number; order: number[] }[];
  standings: {
    name: string;
    count: number;
    tierCount: number;
    duels: [winner: number, loser: number][];
    expect: {
      order: number[];
      logStrength: number[];
      wins: number[];
      played: number[];
      tiers: number[][];
      thin: boolean;
    };
  }[];
  games: GameCase[];
  refine: { name: string; count: number; history: Outcome[]; expect: { pairs: number[][] } }[];
}

interface GameCase {
  name: string;
  kind: GameKind;
  count: number;
  seed: number;
  refine: boolean;
  tierCount: number;
  answers: "lowerWins" | "higherWins" | "script";
  script?: ("first" | "second" | "skip")[];
  expect: { history: Outcome[]; tiers: number[][]; thin: boolean };
}

const vectors = JSON.parse(vectorsText) as Vectors;

const specOf = ({ kind, count, seed, refine }: GameCase): GameSpec => ({
  kind,
  count,
  seed,
  refine,
});

/** Plays a case to the end with its answer rule, as the app's SharedVectors.play does. */
function play(game: GameCase): Outcome[] {
  const spec = specOf(game);
  const history: Outcome[] = [];
  for (let pair = nextPair(spec, history); pair !== null; pair = nextPair(spec, history)) {
    const [first, second] = pair;
    const answer = (): number | null => {
      if (game.answers === "lowerWins") return Math.min(first, second);
      if (game.answers === "higherWins") return Math.max(first, second);
      const step = game.script![history.length % game.script!.length];
      return step === "first" ? first : step === "second" ? second : null;
    };
    history.push([first, second, answer()]);
  }
  return history;
}

describe("the shared vectors", () => {
  it("are the version this engine was ported against, with every kind of vector it checks", () => {
    expect(vectors.version).toBe(1);
    expect(Object.keys(vectors)).toEqual([
      "version",
      "mulberry32",
      "shuffle",
      "standings",
      "games",
      "refine",
    ]);
  });

  it.each(vectors.mulberry32)("mulberry32 from seed $seed", ({ seed, first }) => {
    const random = new Mulberry32(seed);
    expect(first.map(() => random.nextUInt())).toEqual(first);
  });

  it.each(vectors.shuffle)("shuffle of $count from seed $seed", ({ count, seed, order }) => {
    expect(shuffled(count, seed)).toEqual(order);
  });

  it.each(vectors.standings)("standing: $name", (vector) => {
    const scored = standing(
      vector.count,
      vector.duels.map(([winner, loser]) => ({ winner, loser })),
    );
    expect({
      ...scored,
      tiers: tiers(scored, vector.tierCount),
      thin: isThin(scored),
    }).toEqual(vector.expect);
  });

  it.each(vectors.games)("game: $name", (game) => {
    const history = play(game);
    expect({
      history,
      tiers: result(specOf(game), history, game.tierCount),
      thin: isThin(standing(game.count, duels(history))),
    }).toEqual(game.expect);
  });

  it.each(vectors.refine)("refine: $name", ({ count, history, expect: wanted }) => {
    expect(refinePairs(count, history)).toEqual(wanted.pairs);
  });
});
