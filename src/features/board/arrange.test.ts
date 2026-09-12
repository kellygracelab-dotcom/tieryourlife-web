import { describe, expect, it } from "vitest";
import type { PublishedTier } from "../../api/types";
import { arrange } from "./arrange";

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

    expect(result.rows.map((row) => row.items.map((i) => i.title))).toEqual([
      ["one", "four"],
      ["two"],
    ]);
    expect(result.pool.map((i) => i.title)).toEqual(["three"]);
    expect(result.known).toBe(true);
  });

  it("treats an index the tiers do not have as unranked", () => {
    const result = arrange({ tiers: [tier("S")], items: [item("lost", 7), item("neg", -1)] });
    expect(result.rows[0]?.items).toEqual([]);
    expect(result.pool.map((i) => i.title)).toEqual(["lost", "neg"]);
  });

  it("knows when a snapshot never carried an arrangement", () => {
    const result = arrange({ tiers: [tier("S")], items: [item("old"), item("older", null)] });
    expect(result.known).toBe(false);
    expect(result.pool).toHaveLength(2);
  });

  it("keeps empty tiers as empty rows", () => {
    const result = arrange({ tiers: [tier("S"), tier("A")], items: [] });
    expect(result.rows).toHaveLength(2);
    expect(result.pool).toEqual([]);
  });
});
