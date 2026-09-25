import { describe, expect, it } from "vitest";
import { bandOf, DOCK_KEY, defaultDock, keepDock, readDock, rowsThatFit } from "./dock";

const memory = () => {
  const data = new Map<string, string>();
  return {
    read: (key: string) => data.get(key) ?? null,
    write: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe("the pool's dock", () => {
  it("goes under the board only on a wide, tall window", () => {
    expect(defaultDock(2000, 1000)).toBe("under");
    expect(defaultDock(1400, 760)).toBe("under");
    expect(defaultDock(1399, 1000)).toBe("beside");
    expect(defaultDock(2000, 759)).toBe("beside");
    expect(bandOf(1399)).toBe("narrow");
    expect(bandOf(1400)).toBe("wide");
  });

  it("shows only as many rows as leave the board two occupied rows on a window this tall", () => {
    expect(rowsThatFit(970)).toBe(4);
    expect(rowsThatFit(858)).toBe(4);
    expect(rowsThatFit(857)).toBe(3);
    expect(rowsThatFit(760)).toBe(3);
    expect(rowsThatFit(700)).toBe(2);
    expect(rowsThatFit(500)).toBe(1);
  });

  it("keeps a choice and the rows per band, and leaves the other band alone", () => {
    const store = memory();
    expect(readDock(store.read, "wide")).toEqual({ dock: null, rows: 2 });

    keepDock(store.read, store.write, "wide", { dock: "beside", rows: 3 });
    keepDock(store.read, store.write, "narrow", { dock: "under", rows: 1 });
    expect(readDock(store.read, "wide")).toEqual({ dock: "beside", rows: 3 });
    expect(readDock(store.read, "narrow")).toEqual({ dock: "under", rows: 1 });

    keepDock(store.read, store.write, "wide", { dock: null, rows: 4 });
    expect(readDock(store.read, "wide")).toEqual({ dock: null, rows: 4 });
    expect(readDock(store.read, "narrow")).toEqual({ dock: "under", rows: 1 });
  });

  it("treats a broken or foreign value as no choice", () => {
    const store = memory();
    store.data.set(DOCK_KEY, "{not json");
    expect(readDock(store.read, "wide")).toEqual({ dock: null, rows: 2 });
    store.data.set(DOCK_KEY, JSON.stringify({ wide: { dock: "sideways", rows: 9 } }));
    expect(readDock(store.read, "wide")).toEqual({ dock: null, rows: 2 });
    expect(
      readDock(() => {
        throw new Error("no storage");
      }, "wide"),
    ).toEqual({ dock: null, rows: 2 });
  });
});
