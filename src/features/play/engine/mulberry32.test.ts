import { describe, expect, it } from "vitest";
import { Mulberry32, shuffled } from "./mulberry32";

describe("Mulberry32", () => {
  it("draws the app's first number from seed 42", () => {
    expect(new Mulberry32(42).nextUInt()).toBe(2581720956);
  });

  it("gives a fraction of 2^32 in [0, 1)", () => {
    const raw = new Mulberry32(-1);
    const fraction = new Mulberry32(-1);
    for (let draw = 0; draw < 100; draw++) {
      const value = fraction.nextDouble();
      expect(value).toBe(raw.nextUInt() / 4294967296);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("takes a seed as a signed 32-bit integer, as the app's Int is", () => {
    expect(new Mulberry32(2 ** 32 + 42).nextUInt()).toBe(new Mulberry32(42).nextUInt());
    expect(new Mulberry32(0xffffffff).nextUInt()).toBe(new Mulberry32(-1).nextUInt());
  });
});

describe("shuffled", () => {
  it("is a permutation, and the same seed gives the same one", () => {
    const order = shuffled(20, 11);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(shuffled(20, 11)).toEqual(order);
  });

  it("leaves nothing and one card as they are", () => {
    expect(shuffled(0, 5)).toEqual([]);
    expect(shuffled(1, 5)).toEqual([0]);
  });
});
