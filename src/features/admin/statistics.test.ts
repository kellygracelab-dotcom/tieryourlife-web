import { describe, expect, it } from "vitest";
import { changeOf, csvOf, percentOf, rangeOf, sortRows } from "./statistics";

const NOON = Date.UTC(2026, 10, 20, 12);

describe("rangeOf", () => {
  it("ends every period today, both ends counted", () => {
    expect(rangeOf("today", NOON)).toEqual({ from: "2026-11-20", to: "2026-11-20" });
    expect(rangeOf("7", NOON)).toEqual({ from: "2026-11-14", to: "2026-11-20" });
    expect(rangeOf("30", NOON)).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(rangeOf("90", NOON)).toEqual({ from: "2026-08-23", to: "2026-11-20" });
  });

  it("takes a custom period in order, and none until both dates are whole", () => {
    expect(rangeOf("custom", NOON, { from: "2026-11-10", to: "2026-11-01" })).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
    });
    expect(rangeOf("custom", NOON, { from: "2026-11-10", to: "" })).toBeNull();
    expect(rangeOf("custom", NOON, { from: "2026-13-45", to: "2026-11-01" })).toBeNull();
  });
});

describe("changeOf", () => {
  it("compares a count by percent and a share by points", () => {
    expect(changeOf(112, 100, false)).toEqual({ by: 12, direction: "up", points: false });
    expect(changeOf(0.18, 0.2, true)).toEqual({ by: -2, direction: "down", points: true });
    expect(changeOf(5, 5, false)).toEqual({ by: 0, direction: "same", points: false });
  });

  it("says nothing when either side is not counted, or the one before was nothing", () => {
    expect(changeOf(null, 5, false)).toBeNull();
    expect(changeOf(5, null, false)).toBeNull();
    expect(changeOf(5, 0, false)).toBeNull();
  });
});

describe("percentOf", () => {
  it("keeps one decimal only where there is one", () => {
    expect(percentOf(0.996)).toBe("99.6%");
    expect(percentOf(0.18)).toBe("18%");
  });
});

describe("csvOf", () => {
  it("quotes what needs it and keeps a formula from running", () => {
    const csv = csvOf(
      [
        { label: "Search", value: (row: { q: string; n: number }) => row.q },
        { label: "Times", value: (row: { q: string; n: number }) => row.n },
      ],
      [
        { q: 'cats, "big"', n: 3 },
        { q: "=HYPERLINK()", n: 4 },
      ],
    );
    expect(csv).toBe('Search,Times\r\n"cats, ""big""",3\r\n\'=HYPERLINK(),4');
  });
});

describe("sortRows", () => {
  it("sorts by a column either way, keeps ties in order and leaves the uncounted last", () => {
    const rows = [
      { q: "b", n: 2 },
      { q: "a", n: null },
      { q: "c", n: 2 },
      { q: "d", n: 5 },
    ];
    expect(sortRows(rows, (row) => row.n, true).map((row) => row.q)).toEqual(["d", "b", "c", "a"]);
    expect(sortRows(rows, (row) => row.q, false).map((row) => row.q)).toEqual(["a", "b", "c", "d"]);
  });
});
