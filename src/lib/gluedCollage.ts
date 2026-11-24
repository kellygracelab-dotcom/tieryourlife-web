/**
 * A board's cover collage glued into one picture on this device (cover-collage
 * BRIEF, steps 2 and 3, 24.11.2026): Your lists showed up to six pictures for
 * every board without a cover of its own, each its own load. The first time
 * a tile's pictures have all come, they are drawn once on a canvas as the
 * mosaic lays them out, and the picture is kept in this browser's own
 * database; the next open shows that one picture straight away. A board is
 * private: the picture is never sent anywhere, never in a shared cache, and
 * goes when somebody else is shown here.
 */

import { mediaSrc } from "../../functions/src/publicMedia";
import { frameOf, shownFocus, type CoverFocus } from "./coverFocus";
import { privatePicturePath } from "./privatePictureRef";

/** How a glued collage is drawn: a change to the drawing makes every kept one new. */
export const GLUED_LOOK = 1;
/** The mosaic's 2px between pictures (ListArt.css, .art--mosaic). */
const GAP = 2;
/** The fewest pictures that make a collage, and the most the mosaic shows. */
export const GLUED_MIN = 2;
export const GLUED_MAX = 6;
/** Pictures kept in all, the oldest going first: a few MB at most. */
export const KEPT_MAX = 120;
/** A picture bigger than this is not kept (a PNG where WebP cannot be written). */
const KEPT_BYTES = 1_500_000;
/** Collages drawn at once: the page keeps scrolling while they are. */
const DRAWING_AT_ONCE = 2;
/** This browser's own database of glued pictures, by key, each with when it was kept. */
export const GLUED_DATABASE = "tyl-glued";
export const GLUED_STORE = "pictures";

export interface GluedPicture {
  url: string;
  focus: CoverFocus | null;
}

/** The tile's size in CSS pixels, whole. */
export interface Shape {
  width: number;
  height: number;
}

/** A rectangle in the picture, in its pixels. */
export interface Cell {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pictures per row, as the mosaic lays out each count: five is three over two. */
const ROWS: Readonly<Record<number, readonly number[]>> = {
  2: [2],
  3: [3],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
};

/**
 * Where each of [count] pictures goes in a width×height frame with [gap]
 * between them: the mosaic's grid, rows of equal height, the cells of a row
 * of equal width, edges rounded as a browser rounds a grid of thirds.
 */
export function gluedCells(count: number, width: number, height: number, gap = GAP): Cell[] {
  const rows = ROWS[Math.min(Math.max(count, GLUED_MIN), GLUED_MAX)] ?? [];
  const rowHeight = (height - (rows.length - 1) * gap) / rows.length;
  return rows.flatMap((perRow, row) => {
    const cellWidth = (width - (perRow - 1) * gap) / perRow;
    const top = Math.round(row * (rowHeight + gap));
    const bottom = Math.round(row * (rowHeight + gap) + rowHeight);
    return Array.from({ length: perRow }, (_, at) => {
      const left = Math.round(at * (cellWidth + gap));
      const right = Math.round(at * (cellWidth + gap) + cellWidth);
      return { left, top, width: right - left, height: bottom - top };
    });
  });
}

/** A short, steady hash of a string (cyrb53): tells one set of pictures from another, nothing more. */
export function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const whoOf = (owner: string | null): string => (owner === null ? "-" : owner);

/**
 * Whose board, which board, the tile's shape and a hash of its pictures in
 * order with their focus: the same key, the kept picture; any change, a new one.
 */
export function gluedKey(
  owner: string | null,
  board: string,
  pictures: readonly GluedPicture[],
  shape: Shape,
): string {
  const drawn = pictures.map(({ url, focus }) =>
    focus === null ? [url] : [url, focus.x, focus.y, focus.zoom],
  );
  return [
    encodeURIComponent(whoOf(owner)),
    encodeURIComponent(board),
    `${shape.width}x${shape.height}`,
    hashOf(JSON.stringify([GLUED_LOOK, drawn])),
  ].join("/");
}

/** Where glued pictures are kept between visits. */
export interface GluedShelf {
  read(key: string): Promise<Blob | null>;
  /** Kept, the board's earlier pictures gone and the oldest beyond the limit. */
  keep(key: string, picture: Blob): Promise<void>;
  /** One picture goes. */
  drop(key: string): Promise<void>;
  /** Everything but [who]'s goes. */
  keepOnly(who: string): Promise<void>;
}

const boardOf = (key: string): string => key.split("/").slice(0, 2).join("/") + "/";
const hashIn = (key: string): string => key.slice(key.lastIndexOf("/") + 1);

interface KeptPicture {
  bytes: ArrayBuffer;
  type: string;
  /** When it was kept, each later than the one before: the oldest go first. */
  at: number;
}

const asked = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((done, failed) => {
    request.onsuccess = () => done(request.result);
    request.onerror = () => failed(request.error);
  });

/**
 * The browser's IndexedDB, or nothing where there is none. Kept as bytes,
 * which every engine stores (Safari once refused Blobs), and read back the
 * same in all of them, Cache Storage not surviving a reload in WebKit's tests.
 */
export function databaseShelf(): GluedShelf | null {
  if (typeof indexedDB === "undefined") return null;
  let opening: Promise<IDBDatabase> | null = null;
  let last = 0;
  const database = () => {
    opening ??= new Promise<IDBDatabase>((done, failed) => {
      const request = indexedDB.open(GLUED_DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(GLUED_STORE).createIndex("at", "at");
      request.onsuccess = () => done(request.result);
      request.onerror = () => failed(request.error);
      request.onblocked = () => failed(new Error("blocked"));
    });
    opening.catch(() => {
      opening = null;
    });
    return opening;
  };
  /** One transaction: [work] asks, the promise settles when it is written. */
  const within = async (
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => void,
  ): Promise<void> => {
    const transaction = (await database()).transaction(GLUED_STORE, mode);
    const written = new Promise<void>((done, failed) => {
      transaction.oncomplete = () => done();
      transaction.onerror = () => failed(transaction.error);
      transaction.onabort = () => failed(transaction.error);
    });
    work(transaction.objectStore(GLUED_STORE));
    return written;
  };
  return {
    async read(key) {
      const store = (await database()).transaction(GLUED_STORE).objectStore(GLUED_STORE);
      const kept = (await asked(store.get(key))) as KeptPicture | undefined;
      return kept === undefined ? null : new Blob([kept.bytes], { type: kept.type });
    },
    async keep(key, picture) {
      const bytes = await picture.arrayBuffer();
      last = Math.max(Date.now(), last + 1);
      const kept: KeptPicture = { bytes, type: picture.type, at: last };
      const board = boardOf(key);
      const hash = hashIn(key);
      await within("readwrite", (store) => {
        store.put(kept, key);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          let left = keys.result.length;
          for (const other of keys.result) {
            if (typeof other !== "string" || !other.startsWith(board) || hashIn(other) === hash)
              continue;
            store.delete(other);
            left--;
          }
          if (left <= KEPT_MAX) return;
          const oldest = store.index("at").openKeyCursor();
          oldest.onsuccess = () => {
            const cursor = oldest.result;
            if (cursor === null || left <= KEPT_MAX) return;
            if (cursor.primaryKey !== key) {
              store.delete(cursor.primaryKey);
              left--;
            }
            cursor.continue();
          };
        };
      });
    },
    async drop(key) {
      await within("readwrite", (store) => store.delete(key));
    },
    async keepOnly(who) {
      const mine = encodeURIComponent(who) + "/";
      await within("readwrite", (store) => {
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result)
            if (typeof key !== "string" || !key.startsWith(mine)) store.delete(key);
        };
      });
    },
  };
}

/** The canvas side: one picture's pixels, and the collage drawn and written. */
export interface GluedDrawing {
  load(url: string): Promise<ImageBitmap | null>;
  write(
    pictures: readonly ImageBitmap[],
    focus: readonly (CoverFocus | null)[],
    shape: Shape,
  ): Promise<Blob | null>;
}

/** A picture as the tile shows it: the account's own through Firebase, any other by its address. */
async function loadPicture(url: string): Promise<ImageBitmap | null> {
  try {
    const path = privatePicturePath(url);
    let bytes: Blob | null;
    if (path !== null) {
      const { privatePictureBytes } = await import("./privatePictureBytes");
      bytes = await privatePictureBytes(path);
    } else {
      // The tile has just shown it: it comes from the browser's cache. A
      // site that does not let pages read its pictures leaves the mosaic.
      const response = await fetch(mediaSrc(url));
      bytes = response.ok ? await response.blob() : null;
    }
    return bytes === null ? null : await createImageBitmap(bytes);
  } catch {
    return null;
  }
}

/** The pictures in the mosaic's places, each cut by its focus as FocusedPicture cuts it, the gaps clear. */
async function writeCollage(
  pictures: readonly ImageBitmap[],
  focus: readonly (CoverFocus | null)[],
  shape: Shape,
): Promise<Blob | null> {
  const scale = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 2);
  const width = Math.round(shape.width * scale);
  const height = Math.round(shape.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.imageSmoothingQuality = "high";
  const cells = gluedCells(pictures.length, width, height, GAP * scale);
  for (const [at, cell] of cells.entries()) {
    const picture = pictures[at]!;
    const size = { width: picture.width, height: picture.height };
    const frame = frameOf(size, cell.width / cell.height, shownFocus(focus[at], size));
    context.drawImage(
      picture,
      frame.left,
      frame.top,
      frame.width,
      frame.height,
      cell.left,
      cell.top,
      cell.width,
      cell.height,
    );
  }
  return new Promise((done) => canvas.toBlob(done, "image/webp", 0.85));
}

const canvasDrawing: GluedDrawing = { load: loadPicture, write: writeCollage };

/** This visit's pictures, by key: shown again with no wait at all. */
const shown = new Map<string, string>();
/** Keys that could not be drawn this visit (a picture would not load): the mosaic stays. */
const failed = new Set<string>();
const drawing = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = 0;
let shelf: GluedShelf | null | undefined;
let draw: GluedDrawing = canvasDrawing;
let who: string | null | undefined;

const shelfNow = (): GluedShelf | null => {
  if (shelf === undefined) {
    try {
      shelf = databaseShelf();
    } catch {
      shelf = null;
    }
  }
  return shelf;
};

const remember = (key: string, picture: Blob): string => {
  const url = URL.createObjectURL(picture);
  const earlier = shown.get(key);
  if (earlier !== undefined) URL.revokeObjectURL(earlier);
  shown.delete(key);
  shown.set(key, url);
  while (shown.size > KEPT_MAX) {
    const [oldest, address] = shown.entries().next().value!;
    shown.delete(oldest);
    URL.revokeObjectURL(address);
  }
  return url;
};

/** The picture already shown this visit, at once. */
export const gluedNow = (key: string): string | null => shown.get(key) ?? null;

/** The kept picture for [key], or null when there is none yet. */
export async function gluedKept(key: string): Promise<string | null> {
  const now = gluedNow(key);
  if (now !== null) return now;
  const kept = shelfNow();
  if (kept === null) return null;
  try {
    const picture = await kept.read(key);
    return picture === null ? null : (gluedNow(key) ?? remember(key, picture));
  } catch {
    return null;
  }
}

/** A kept picture that would not show: it goes, and the mosaic is drawn again next time. */
export function gluedBroken(key: string): void {
  const url = shown.get(key);
  if (url !== undefined) URL.revokeObjectURL(url);
  shown.delete(key);
  failed.add(key);
  void shelfNow()
    ?.drop(key)
    .catch(() => undefined);
}

const next = () => {
  while (running < DRAWING_AT_ONCE && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      next();
    });
  }
};

/**
 * Glues [pictures] for [key] when the browser has a moment, once a visit:
 * kept for the next open. Nothing if any picture will not load or draw.
 */
export function glueLater(key: string, pictures: readonly GluedPicture[], shape: Shape): void {
  if (shown.has(key) || failed.has(key) || drawing.has(key)) return;
  if (pictures.length < GLUED_MIN || pictures.length > GLUED_MAX) return;
  if (shape.width <= 0 || shape.height <= 0) return;
  drawing.add(key);
  queue.push(async () => {
    const loaded = await Promise.all(pictures.map(({ url }) => draw.load(url)));
    try {
      const whole = loaded.every((picture) => picture !== null);
      const picture = whole
        ? await draw.write(
            loaded as ImageBitmap[],
            pictures.map(({ focus }) => focus),
            shape,
          )
        : null;
      if (picture === null || picture.size === 0) {
        failed.add(key);
        return;
      }
      remember(key, picture);
      if (picture.size <= KEPT_BYTES) await shelfNow()?.keep(key, picture);
    } catch {
      failed.add(key);
    } finally {
      for (const picture of loaded) picture?.close();
      drawing.delete(key);
    }
  });
  next();
}

/**
 * Only [owner]'s pictures stay (null: the boards made without an account):
 * somebody signed out, or another account came, and the earlier one's go.
 */
export function keepGluedOf(owner: string | null): void {
  const now = whoOf(owner);
  if (who === now) return;
  who = now;
  const mine = encodeURIComponent(now) + "/";
  for (const [key, url] of [...shown]) {
    if (key.startsWith(mine)) continue;
    URL.revokeObjectURL(url);
    shown.delete(key);
  }
  void shelfNow()
    ?.keepOnly(now)
    .catch(() => undefined);
}

/** For tests: another shelf and canvas, and a fresh visit. */
export function resetGluedForTests(
  using: { shelf?: GluedShelf | null; drawing?: GluedDrawing } = {},
): void {
  for (const url of shown.values()) URL.revokeObjectURL(url);
  shown.clear();
  failed.clear();
  drawing.clear();
  queue.length = 0;
  running = 0;
  shelf = using.shelf;
  draw = using.drawing ?? canvasDrawing;
  who = undefined;
}

/** For tests: every drawing asked for so far has finished. */
export async function gluedSettled(): Promise<void> {
  while (running > 0 || queue.length > 0) await new Promise((done) => setTimeout(done, 0));
}
