/**
 * The name on a card without a picture, the phone's `CardLabel`: the type
 * steps down until every word sits on one line of the tile, so "Ex Machina"
 * never becomes "Machin / a". Only a word too long even at the smallest size
 * is left to the breaker, and then with hyphens.
 *
 * On the board a card without a picture is as wide as a poster (`.tile--name`;
 * night W3, 18.11.2026: a wider one left the rows and the pool's grid uneven),
 * so its name may go smaller there and must also fit the tile's three lines.
 */

/** The board's three sizes, by the window's width (board.css draws the same). */
export type BoardSize = "small" | "medium" | "large";

export const boardSizeOf = (width: number): BoardSize =>
  width < 600 ? "small" : width < 1200 ? "medium" : "large";

/** A name on a poster-wide tile (Play's cards), or on the board's name tile, as wide. */
export type NameShape = "poster" | "board";

interface NameType {
  /** The tile's width and height, in px. */
  tile: number;
  height: number;
  /** Where the name starts, and the smallest it goes. */
  start: number;
  floor: number;
}

/** Each size's tile in a row, and where its name starts and the smallest it goes, in px. */
export const NAME_TYPE: Record<BoardSize, NameType> = {
  small: { tile: 44, height: 64, start: 9, floor: 8 },
  medium: { tile: 52, height: 76, start: 10, floor: 9 },
  large: { tile: 64, height: 90, start: 11, floor: 9 },
};

/**
 * The board's name tile: a poster's size (board.css, `.tile--name`). Its name
 * starts a size up and may go a size under a poster's, so a long word stays
 * whole on a phone's 44 px card.
 */
export const BOARD_NAME_TYPE: Record<BoardSize, NameType> = {
  small: { tile: 44, height: 64, start: 10, floor: 7 },
  medium: { tile: 52, height: 76, start: 11, floor: 8 },
  large: { tile: 64, height: 90, start: 12, floor: 9 },
};

/** The tile's padding on both sides: the name has the rest of its width. */
const INSET = 8;
/** The board's name tile pads its name less (board.css, `.tile--name .tile__name`). */
const BOARD_INSET = 4;
/**
 * A word measured on the canvas lands a hair narrower than the page sets it
 * (the face may still be loading): "Moonlight" fitted to the pixel and lost
 * its "t" to a line of its own. Two pixels to spare.
 */
const SLACK = 2;
/** Half a pixel at a time: a ratio alone landed a hair too wide on the phone. */
const STEP = 0.5;
/** The lines a name tile shows (`.tile__name`'s clamp), and their height, as a share of the size. */
const MAX_LINES = 3;
const LINE_HEIGHT = 1.2;
/** The name's padding at the top and its margin at the foot. */
const BLOCK_INSET = 8;

/** How wide one word is, set at a size in px. */
export type Measure = (word: string, size: number) => number;

export interface NameFit {
  /** The font size, in px. */
  size: number;
  /** A word is wider than the tile even at the floor: the breaker may cut it, with a hyphen. */
  hyphenate: boolean;
}

/** How many lines the words take, broken between words only, as the page breaks them. */
function linesOf(words: readonly string[], size: number, room: number, measure: Measure): number {
  let lines = 0;
  let line = "";
  for (const word of words) {
    const longer = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(longer, size) > room) {
      lines += 1;
      line = word;
    } else {
      line = longer;
    }
  }
  return line === "" ? lines : lines + 1;
}

export function fitName(
  name: string,
  board: BoardSize,
  measure: Measure,
  shape: NameShape = "poster",
): NameFit {
  const onBoard = shape === "board";
  const { tile, height, start, floor } = (onBoard ? BOARD_NAME_TYPE : NAME_TYPE)[board];
  const room = tile - (onBoard ? BOARD_INSET + SLACK : INSET);
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const wordsFit = (size: number) => words.every((word) => measure(word, size) <= room);
  // On the board the whole name stays in sight, not only each word.
  const linesFit = (size: number) => {
    if (!onBoard) return true;
    const shown = Math.min(MAX_LINES, Math.floor((height - BLOCK_INSET) / (size * LINE_HEIGHT)));
    return linesOf(words, size, room, measure) <= shown;
  };
  for (let size = start; size >= floor; size -= STEP) {
    if (wordsFit(size) && linesFit(size)) return { size, hyphenate: false };
  }
  return { size: floor, hyphenate: !wordsFit(floor) };
}

/** fitName with every answer kept: a name is measured once at each size of the board. */
export function nameFitter(
  measure: Measure,
): (name: string, board: BoardSize, shape?: NameShape) => NameFit {
  const kept = new Map<string, NameFit>();
  return (name, board, shape = "poster") => {
    const key = `${board}\n${shape}\n${name}`;
    const known = kept.get(key);
    if (known !== undefined) return known;
    const fit = fitName(name, board, measure, shape);
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
