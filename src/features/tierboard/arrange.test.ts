import { describe, expect, it } from "vitest";
import type { PublishedTier } from "../../api/types";
import { arrange, poolOf } from "./arrange";

const tier = (label: string): PublishedTier => ({
  label,
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
});

const item = (title: string, tierIndex?: number | null) => ({ title, imageUrl: null, tierIndex });

describe("arrange", () => {
  it("puts every item where the author left it and the rest in the pool", () => {
    const result = arrange({
      tiers: [tier("S"), tier("A")],
      items: [item("one", 0), item("two", 1), item("three", null), item("four", 0)],
    });

    expect(result.rows).toEqual([[0, 3], [1]]);
    expect(result.pool).toEqual([2]);
    expect(result.known).toBe(true);
  });

  it("treats an index the tiers do not have as unranked", () => {
    const result = arrange({ tiers: [tier("S")], items: [item("lost", 7), item("neg", -1)] });
    expect(result.rows).toEqual([[]]);
    expect(result.pool).toEqual([0, 1]);
  });

  it("knows when a snapshot never carried an arrangement", () => {
    const result = arrange({ tiers: [tier("S")], items: [item("old"), item("older", null)] });
    expect(result.known).toBe(false);
    expect(result.pool).toEqual([0, 1]);
  });

  it("keeps empty tiers as empty rows", () => {
    const result = arrange({ tiers: [tier("S"), tier("A")], items: [] });
    expect(result.rows).toEqual([[], []]);
    expect(result.pool).toEqual([]);
  });
});

describe("poolOf", () => {
  it("is every item the rows leave out, in list order", () => {
    expect(poolOf([[3], [0]], 5)).toEqual([1, 2, 4]);
    expect(poolOf([[], []], 0)).toEqual([]);
  });
});
