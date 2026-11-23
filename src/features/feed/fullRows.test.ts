import { afterEach, describe, expect, it, vi } from "vitest";
import { columnsOf, fullRows } from "./fullRows";

describe("fullRows", () => {
  it("keeps whole rows only while more are to come", () => {
    expect(fullRows(20, 8, true)).toBe(16);
    expect(fullRows(20, 3, true)).toBe(18);
    expect(fullRows(20, 4, true)).toBe(20);
    expect(fullRows(20, 2, true)).toBe(20);
  });

  it("shows every card on the last page, with fewer than a row, or unmeasured", () => {
    expect(fullRows(20, 8, false)).toBe(20);
    expect(fullRows(5, 8, true)).toBe(5);
    expect(fullRows(20, null, true)).toBe(20);
    expect(fullRows(0, 4, true)).toBe(0);
  });
});

describe("columnsOf", () => {
  afterEach(() => vi.restoreAllMocks());

  const laidOut = (tracks: string) => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      gridTemplateColumns: tracks,
    } as CSSStyleDeclaration);
    return columnsOf(document.createElement("ul"));
  };

  it("counts the tracks a browser computed", () => {
    expect(laidOut("250px 250px 250.5px")).toBe(3);
  });

  it("is null where nothing laid the grid out", () => {
    expect(laidOut("")).toBeNull();
    expect(laidOut("none")).toBeNull();
    expect(laidOut("repeat(2, minmax(0, 1fr))")).toBeNull();
  });
});
