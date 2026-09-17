import { describe, expect, it } from "vitest";
import { indexAt } from "./tierDrag";

describe("indexAt", () => {
  const middles = [20, 60, 100, 140];

  it("keeps a row where it is until the pointer crosses a neighbour's middle", () => {
    expect(indexAt(20, middles, 0)).toBe(0);
    expect(indexAt(59, middles, 0)).toBe(0);
    expect(indexAt(61, middles, 0)).toBe(1);
    expect(indexAt(141, middles, 0)).toBe(3);
  });

  it("counts crossings upward the same way", () => {
    expect(indexAt(140, middles, 3)).toBe(3);
    expect(indexAt(99, middles, 3)).toBe(2);
    expect(indexAt(0, middles, 3)).toBe(0);
  });
});
