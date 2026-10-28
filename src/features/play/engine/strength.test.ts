import { describe, expect, it } from "vitest";
import { duelsPerCard, roundNine, standing, type Duel } from "./strength";

const duel = (winner: number, loser: number): Duel => ({ winner, loser });

describe("standing", () => {
  it("ranks a chain in its order", () => {
    expect(standing(4, [duel(0, 1), duel(1, 2), duel(2, 3)]).order).toEqual([0, 1, 2, 3]);
  });

  it("keeps an unbeaten card finite", () => {
    const scored = standing(
      2,
      Array.from({ length: 10 }, () => duel(1, 0)),
    );
    expect(Number.isFinite(scored.logStrength[1])).toBe(true);
    expect(scored.order).toEqual([1, 0]);
  });

  it("leaves a card nobody met at strength 1, and breaks a tie by wins, then original order", () => {
    const scored = standing(4, [duel(2, 3), duel(3, 2)]);
    expect(scored.logStrength).toEqual([0, 0, 0, 0]);
    expect(scored.order).toEqual([2, 3, 0, 1]);
  });

  it("counts wins and real duels per card", () => {
    const scored = standing(3, [duel(0, 1), duel(0, 2), duel(1, 2)]);
    expect(scored.wins).toEqual([2, 1, 0]);
    expect(scored.played).toEqual([2, 2, 2]);
  });
});

describe("duelsPerCard", () => {
  it("counts each duel for both its cards", () => {
    expect(duelsPerCard(standing(4, [duel(0, 1), duel(2, 3), duel(0, 2)]))).toBe(1.5);
  });

  it("is nothing for no cards", () => {
    expect(duelsPerCard(standing(0, []))).toBe(0);
  });
});

describe("roundNine", () => {
  it("rounds to nine places, half up", () => {
    expect(roundNine(Math.log(3))).toBe(1.098612289);
    expect(roundNine(-Math.log(3))).toBe(-1.098612289);
    expect(roundNine(0.0000000005)).toBe(0.000000001);
    expect(roundNine(0)).toBe(0);
  });
});
