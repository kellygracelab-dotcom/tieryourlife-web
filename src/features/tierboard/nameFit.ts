/**
 * The name on a card without a picture, the phone's `CardLabel`: the type
 * steps down until every word sits on one line of the tile, so "Ex Machina"
 * never becomes "Machin / a". Only a word too long even at the smallest size
 * is left to the breaker, and then with hyphens.
 */

/** The board's three sizes, by the window's width (board.css draws the same). */
export type BoardSize = "small" | "medium" | "large";

export const boardSizeOf = (width: number): BoardSize =>
  width < 600 ? "small" : width < 1200 ? "medium" : "large";

/** Each size's tile in a row, and where its name starts and the smallest it goes, in px. */
export const NAME_TYPE: Record<BoardSize, { tile: number; start: number; floor: number }> = {
  small: { tile: 44, start: 9, floor: 8 },
  medium: { tile: 52, start: 10, floor: 9 },
  large: { tile: 64, start: 11, floor: 9 },
};

/** The tile's padding on both sides: the name has the rest of its width. */
const INSET = 8;
/** Half a pixel at a time: a ratio alone landed a hair too wide on the phone. */
const STEP = 0.5;

/** How wide one word is, set at a size in px. */
export type Measure = (word: string, size: number) => number;

export interface NameFit {
  /** The font size, in px. */
  size: number;
  /** A word is wider than the tile even at the floor: the breaker may cut it, with a hyphen. */
  hyphenate: boolean;
}

export function fitName(name: string, board: BoardSize, measure: Measure): NameFit {
  const { tile, start, floor } = NAME_TYPE[board];
  const room = tile - INSET;
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const fits = (size: number) => words.every((word) => measure(word, size) <= room);
  for (let size = start; size >= floor; size -= STEP) {
    if (fits(size)) return { size, hyphenate: false };
  }
  return { size: floor, hyphenate: true };
}

/** fitName with every answer kept: a name is measured once at each size of the board. */
export function nameFitter(measure: Measure): (name: string, board: BoardSize) => NameFit {
  const kept = new Map<string, NameFit>();
  return (name, board) => {
    const key = `${board}\n${name}`;
    const known = kept.get(key);
    if (known !== undefined) return known;
    const fit = fitName(name, board, measure);
    kept.set(key, fit);
    return fit;
  };
}

/**
 * The name's own type (.tile__name), measured on a canvas that is never
 * drawn. Null where there is no such canvas: the name then starts at its
 * size and leans on hyphens.
 */
export function canvasMeasure(): Measure | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (context === null) return null;
  return (word, size) => {
    context.font = `500 ${size}px Roboto, system-ui, sans-serif`;
    return context.measureText(word).width;
  };
}
