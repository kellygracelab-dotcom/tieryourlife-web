import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  databaseShelf,
  gluedBroken,
  gluedCells,
  gluedKept,
  gluedKey,
  gluedNow,
  gluedSettled,
  glueLater,
  keepGluedOf,
  resetGluedForTests,
  type GluedDrawing,
  type GluedShelf,
} from "./gluedCollage";

const picture = (url: string) => ({ url, focus: null });
const shape = { width: 240, height: 132 };

function memoryShelf(): GluedShelf & { kept: Map<string, Blob> } {
  const kept = new Map<string, Blob>();
  return {
    kept,
    read: async (key) => kept.get(key) ?? null,
    keep: async (key, bytes) => void kept.set(key, bytes),
    drop: async (key) => void kept.delete(key),
    keepOnly: async (who) => {
      for (const key of [...kept.keys()]) if (!key.startsWith(who + "/")) kept.delete(key);
    },
  };
}

const bitmap = () => ({ width: 10, height: 10, close: vi.fn() }) as unknown as ImageBitmap;

function drawingOf(missing: readonly string[] = []): GluedDrawing & { written: number } {
  const drawing = {
    written: 0,
    load: async (url: string) => (missing.includes(url) ? null : bitmap()),
    write: async () => {
      drawing.written++;
      return new Blob(["webp"], { type: "image/webp" });
    },
  };
  return drawing;
}

let made = 0;
beforeEach(() => {
  made = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:glued-${++made}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  resetGluedForTests();
  vi.unstubAllGlobals();
});

describe("gluedCells", () => {
  it("lays out each count as the mosaic does, 2px apart, filling the frame", () => {
    expect(gluedCells(2, 480, 300)).toEqual([
      { left: 0, top: 0, width: 239, height: 300 },
      { left: 241, top: 0, width: 239, height: 300 },
    ]);
    const five = gluedCells(5, 480, 300);
    expect(five.map(({ top }) => top)).toEqual([0, 0, 0, 151, 151]);
    expect(five.slice(0, 3).map(({ width }) => width)).toEqual([159, 158, 159]);
    expect(five.slice(3).map(({ width }) => width)).toEqual([239, 239]);
    for (const count of [2, 3, 4, 5, 6]) {
      const cells = gluedCells(count, 480, 300);
      expect(cells).toHaveLength(count);
      expect(Math.max(...cells.map(({ left, width }) => left + width))).toBe(480);
      expect(Math.max(...cells.map(({ top, height }) => top + height))).toBe(300);
    }
  });

  it("scales the gap with the picture's pixels", () => {
    expect(gluedCells(2, 100, 50, 4)).toEqual([
      { left: 0, top: 0, width: 48, height: 50 },
      { left: 52, top: 0, width: 48, height: 50 },
    ]);
  });
});

describe("gluedKey", () => {
  const pictures = [picture("https://a/1.jpg"), picture("https://a/2.jpg")];
  const key = gluedKey("me", "board-1", pictures, shape);

  it("stays the same for the same pictures, shape and owner", () => {
    expect(gluedKey("me", "board-1", [...pictures], { ...shape })).toBe(key);
    expect(key.startsWith("me/board-1/240x132/")).toBe(true);
  });

  it("changes with the pictures, their order and focus, the shape, the board and whose it is", () => {
    const others = [
      gluedKey("me", "board-1", [pictures[1]!, pictures[0]!], shape),
      gluedKey("me", "board-1", [pictures[0]!, picture("https://a/3.jpg")], shape),
      gluedKey(
        "me",
        "board-1",
        [{ url: "https://a/1.jpg", focus: { x: 0.5, y: 0.2, zoom: 1 } }, pictures[1]!],
        shape,
      ),
      gluedKey("me", "board-1", pictures, { width: 56, height: 56 }),
      gluedKey("me", "board-2", pictures, shape),
      gluedKey(null, "board-1", pictures, shape),
    ];
    expect(new Set([key, ...others]).size).toBe(others.length + 1);
    expect(others.at(-1)!.startsWith("-/board-1/")).toBe(true);
  });
});

describe("gluing", () => {
  const pictures = [
    picture("https://a/1.jpg"),
    picture("https://a/2.jpg"),
    picture("https://a/3.jpg"),
  ];
  const key = gluedKey("me", "board-1", pictures, shape);

  it("draws once, shows it again this visit and keeps it for the next", async () => {
    const shelf = memoryShelf();
    const drawing = drawingOf();
    resetGluedForTests({ shelf, drawing });
    expect(await gluedKept(key)).toBeNull();
    glueLater(key, pictures, shape);
    glueLater(key, pictures, shape);
    await gluedSettled();
    expect(drawing.written).toBe(1);
    expect(gluedNow(key)).toBe("blob:glued-1");
    expect(shelf.kept.has(key)).toBe(true);

    // The next visit: no drawing, the kept picture.
    resetGluedForTests({ shelf, drawing });
    expect(await gluedKept(key)).toBe("blob:glued-2");
    expect(gluedNow(key)).toBe("blob:glued-2");
    glueLater(key, pictures, shape);
    await gluedSettled();
    expect(drawing.written).toBe(1);
  });

  it("keeps nothing, and does not try again, when a picture will not load", async () => {
    const shelf = memoryShelf();
    const drawing = drawingOf(["https://a/2.jpg"]);
    resetGluedForTests({ shelf, drawing });
    glueLater(key, pictures, shape);
    await gluedSettled();
    glueLater(key, pictures, shape);
    await gluedSettled();
    expect(drawing.written).toBe(0);
    expect(gluedNow(key)).toBeNull();
    expect(shelf.kept.size).toBe(0);
  });

  it("does not glue one picture, more than six, or a tile not laid out", async () => {
    const drawing = drawingOf();
    resetGluedForTests({ shelf: memoryShelf(), drawing });
    glueLater("a", [picture("https://a/1.jpg")], shape);
    glueLater(
      "b",
      Array.from({ length: 7 }, (_, at) => picture(`https://a/${at}.jpg`)),
      shape,
    );
    glueLater("c", pictures, { width: 0, height: 0 });
    await gluedSettled();
    expect(drawing.written).toBe(0);
  });

  it("drops a kept picture that will not show, and draws no more of it this visit", async () => {
    const shelf = memoryShelf();
    const drawing = drawingOf();
    resetGluedForTests({ shelf, drawing });
    shelf.kept.set(key, new Blob(["bad"]));
    expect(await gluedKept(key)).toBe("blob:glued-1");
    gluedBroken(key);
    await gluedSettled();
    expect(gluedNow(key)).toBeNull();
    expect(shelf.kept.has(key)).toBe(false);
    glueLater(key, pictures, shape);
    await gluedSettled();
    expect(drawing.written).toBe(0);
  });

  it("works without a shelf, for this visit only", async () => {
    const drawing = drawingOf();
    resetGluedForTests({ shelf: null, drawing });
    expect(await gluedKept(key)).toBeNull();
    glueLater(key, pictures, shape);
    await gluedSettled();
    expect(gluedNow(key)).toBe("blob:glued-1");
  });

  it("keeps only whoever is here", async () => {
    const shelf = memoryShelf();
    resetGluedForTests({ shelf, drawing: drawingOf() });
    const theirs = gluedKey("them", "board-9", pictures, shape);
    glueLater(key, pictures, shape);
    glueLater(theirs, pictures, shape);
    await gluedSettled();
    keepGluedOf("me");
    await gluedSettled();
    expect(gluedNow(key)).not.toBeNull();
    expect(gluedNow(theirs)).toBeNull();
    expect([...shelf.kept.keys()]).toEqual([key]);
    keepGluedOf(null);
    expect(gluedNow(key)).toBeNull();
    await vi.waitFor(() => expect(shelf.kept.size).toBe(0));
  });
});

describe("databaseShelf", () => {
  // The database itself is checked in a real browser: e2e/cover-loading.spec.ts.
  it("is nothing where the browser has no IndexedDB", () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(databaseShelf()).toBeNull();
  });
});
