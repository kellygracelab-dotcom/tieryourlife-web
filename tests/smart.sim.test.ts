import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextPair, result, type GameKind, type Outcome } from "../src/features/play/engine/games";
import { Mulberry32 } from "../src/features/play/engine/mulberry32";
import { tiers } from "../src/features/play/engine/tiers";

/*
 * Smart against Losers stay on known strengths (SPEC 6). Run with SIM=1;
 * SIM_OUT names the markdown to write. Each card has a true log-strength,
 * evenly spread over SPREAD and handed to the cards in a shuffled order; a
 * duel is won by the stronger with the logistic chance of their gap, a
 * SLIP of answers is a coin toss, and SKIP of them is skipped. A card's true
 * tier is where the same tiering puts the true strengths.
 */

const TIERS = 5;

interface World {
  name: string;
  spread: number;
  slip: number;
  skip: number;
  /** True strengths in this many clusters, `spread` apart, rather than even. */
  clusters?: number;
}

const ALL_WORLDS: World[] = [
  { name: "tiered", spread: 3, clusters: 5, slip: 0.03, skip: 0.02 },
  { name: "clear", spread: 12, slip: 0.03, skip: 0.02 },
  { name: "noisy", spread: 5, slip: 0.08, skip: 0.03 },
];
const WORLDS = ALL_WORLDS.filter((world) =>
  (process.env.SIM_WORLDS ?? "tiered,clear,noisy").split(",").includes(world.name),
);

interface Run {
  duels: number;
  right: number;
  near: number;
}

function trueTiers(values: number[]): number[] {
  const order = values.map((_, card) => card).sort((a, b) => values[b]! - values[a]! || a - b);
  const scored = {
    order,
    logStrength: values,
    wins: values.map(() => 0),
    played: values.map(() => 100),
  };
  const tierOf = values.map(() => 0);
  tiers(scored, TIERS).forEach((row, tier) => row.forEach((card) => (tierOf[card] = tier)));
  return tierOf;
}

function playOnce(kind: GameKind | "swiss+refine", count: number, world: World, seed: number): Run {
  const random = new Mulberry32(seed);
  const values = Array.from({ length: count }, (_, i) =>
    world.clusters === undefined
      ? (world.spread * i) / (count - 1)
      : Math.floor((i * world.clusters) / count) * world.spread + (random.nextDouble() - 0.5) * 1.2,
  );
  for (let i = count - 1; i >= 1; i--) {
    const j = Math.floor(random.nextDouble() * (i + 1));
    [values[i], values[j]] = [values[j]!, values[i]!];
  }
  const spec =
    kind === "swiss+refine"
      ? { kind: "swiss" as const, count, seed, refine: true }
      : { kind, count, seed, refine: false, tiers: TIERS };
  const history: Outcome[] = [];
  for (let pair = nextPair(spec, history); pair !== null; pair = nextPair(spec, history)) {
    const [a, b] = pair;
    let winner: number | null;
    const roll = random.nextDouble();
    if (roll < world.skip) winner = null;
    else if (roll < world.skip + world.slip) winner = random.nextDouble() < 0.5 ? a : b;
    else {
      const chance = 1 / (1 + Math.exp(values[b]! - values[a]!));
      winner = random.nextDouble() < chance ? a : b;
    }
    history.push([a, b, winner]);
  }
  const truth = trueTiers(values);
  const got = values.map(() => 0);
  result(spec, history, TIERS).forEach((row, tier) => row.forEach((card) => (got[card] = tier)));
  let right = 0;
  let near = 0;
  got.forEach((tier, card) => {
    if (tier === truth[card]) right++;
    if (Math.abs(tier - truth[card]!) <= 1) near++;
  });
  return { duels: history.length, right: right / count, near: near / count };
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const pct = (value: number) => `${(value * 100).toFixed(1)} %`;

describe.skipIf(!process.env.SIM)("smart against Losers stay", () => {
  it("plays every size in every world", () => {
    const sizes = (process.env.SIM_SIZES ?? "10,20,40,80,150").split(",").map(Number);
    const runs = Number(process.env.SIM_RUNS ?? 100);
    const kinds = (process.env.SIM_KINDS ?? "swiss,swiss+refine,smart").split(",") as (
      "swiss" | "swiss+refine" | "smart"
    )[];
    const lines: string[] = [];
    for (const world of WORLDS) {
      lines.push(
        `\n### ${world.name}: ${world.clusters === undefined ? `strengths even over ${world.spread}` : `${world.clusters} clusters ${world.spread} apart, ±0.6 within`}, ${world.slip * 100} % coin tosses, ${world.skip * 100} % skips\n`,
        "| cards | game | duels (mean) | duels (max) | right tier | within one tier |",
        "|---:|---|---:|---:|---:|---:|",
      );
      for (const count of sizes) {
        for (const kind of kinds) {
          const all = Array.from({ length: runs }, (_, run) =>
            playOnce(kind, count, world, 1000 * count + run),
          );
          const name =
            kind === "swiss" ? "Losers stay" : kind === "smart" ? "Smart" : "Losers stay + refine";
          lines.push(
            `| ${count} | ${name} | ${mean(all.map((r) => r.duels)).toFixed(1)} | ${Math.max(...all.map((r) => r.duels))} | ${pct(mean(all.map((r) => r.right)))} | ${pct(mean(all.map((r) => r.near)))} |`,
          );
        }
      }
    }
    const text = lines.join("\n");
    console.log(text);
    if (process.env.SIM_OUT) writeFileSync(process.env.SIM_OUT, text);
    expect(lines.length).toBeGreaterThan(0);
  }, 3_600_000);
});
