import { describe, expect, it } from "vitest";
import { duelsPerCard, standing, type Duel } from "./strength";
import { groupLimit, groupsOf, isDashed, isThin, SOLID_DUELS, THIN_GROUPS, tiers } from "./tiers";

const duel = (winner: number, loser: number): Duel => ({ winner, loser });

// Three cards that beat each of three others: two clear groups.
const twoGroups = [0, 1, 2].flatMap((top) => [3, 4, 5].map((bottom) => duel(top, bottom)));

describe("tiers", () => {
  it("puts everything in the first tier, in the original order, with no duels yet", () => {
    expect(tiers(standing(3, []), 4)).toEqual([[0, 1, 2], [], [], []]);
  });

  it("sends two clear groups to the top and the bottom, leaving the middle empty", () => {
    const placed = tiers(standing(6, twoGroups), 5);
    expect(new Set(placed[0])).toEqual(new Set([0, 1, 2]));
    expect(new Set(placed[4])).toEqual(new Set([3, 4, 5]));
    expect(placed.slice(1, 4).every((tier) => tier.length === 0)).toBe(true);
  });

  it("allows at most three groups on thin evidence", () => {
    // Six cards, five duels: under two per card, so a chain cannot fill six tiers.
    const chain = standing(
      6,
      [0, 1, 2, 3, 4].map((card) => duel(card, card + 1)),
    );
    expect(duelsPerCard(chain)).toBeLessThan(SOLID_DUELS);
    expect(tiers(chain, 6).filter((tier) => tier.length > 0).length).toBeLessThanOrEqual(
      THIN_GROUPS,
    );
  });

  it("needs a tier to put cards in", () => {
    expect(() => tiers(standing(2, []), 0)).toThrow(RangeError);
  });
});

describe("groupLimit", () => {
  it("caps the groups at three while the evidence is thin, and at what fits otherwise", () => {
    expect(groupLimit(standing(6, [duel(0, 1)]), 5)).toBe(THIN_GROUPS);
    expect(groupLimit(standing(6, [duel(0, 1)]), 2)).toBe(2);
    expect(groupLimit(standing(6, twoGroups), 5)).toBe(5);
  });
});

describe("groupsOf", () => {
  it("takes the fewest groups that explain nine tenths of the spread", () => {
    expect(groupsOf([1, 0.95, 0.05, 0], 4)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
  });

  it("takes as many as allowed when none explains enough", () => {
    expect(groupsOf([1, 0.75, 0.5, 0.25, 0], 2)).toHaveLength(2);
  });
});

describe("dashed and thin", () => {
  it("dashes a card that met fewer than two, and calls a quarter dashed thin", () => {
    const scored = standing(4, [duel(0, 1), duel(0, 2), duel(1, 2), duel(0, 1)]);
    expect([0, 1, 2, 3].map((card) => isDashed(scored, card))).toEqual([false, false, false, true]);
    expect(isThin(scored)).toBe(false);
    expect(isThin(standing(4, [duel(0, 1)]))).toBe(true);
  });

  it("does not call two clear groups thin, though the middle is empty", () => {
    expect(isThin(standing(6, twoGroups))).toBe(false);
  });
});
