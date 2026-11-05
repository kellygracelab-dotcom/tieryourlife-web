/**
 * Text set in a box of fixed size, such as a tier's band: the type steps
 * down until every word sits whole on a line and the lines fit the box's
 * height. Shared by the board, which lets the browser break the lines, and
 * the share picture, which draws the lines itself.
 */

/** How wide a run of text is, set at a size in px. */
export type Measure = (text: string, size: number) => number;

export interface TextRoom {
  width: number;
  height: number;
}

export interface TypeRange {
  /** The size in px the text starts at, and the smallest it goes. */
  start: number;
  floor: number;
  /** The line's height as a share of the size. */
  line: number;
}

export interface TextFit {
  size: number;
  /** A word is wider than the box even at the floor: it may be broken, with a hyphen. */
  broken: boolean;
}

/** Half a pixel at a time, as a card's name steps. */
const STEP = 0.5;

const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word.length > 0);

/**
 * The text's lines at a size, broken between words only, as the browser
 * breaks them; a word wider than the box keeps a line to itself.
 */
export function linesOf(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of wordsOf(text)) {
    const longer = line.length === 0 ? word : `${line} ${word}`;
    if (line.length === 0 || measure(longer, size) <= width) {
      line = longer;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * The largest size at which every word fits the width and the lines fit the
 * height. Where the lines are too many even at the floor, the floor: the box
 * grows rather than cutting the text. Only a word too wide even at the floor
 * is left to be broken.
 */
export function fitText(text: string, room: TextRoom, type: TypeRange, measure: Measure): TextFit {
  const words = wordsOf(text);
  const whole = (size: number) => words.every((word) => measure(word, size) <= room.width);
  for (let size = type.start; size >= type.floor; size -= STEP) {
    if (!whole(size)) continue;
    const lines = linesOf(text, room.width, size, measure).length;
    if (lines * size * type.line <= room.height) return { size, broken: false };
  }
  return { size: type.floor, broken: !whole(type.floor) };
}

/**
 * Lines for a picture, which has no browser to break them: between words,
 * and a word wider than the box in pieces, each but the last with a hyphen.
 */
export function drawnLines(text: string, width: number, size: number, measure: Measure): string[] {
  return linesOf(text, width, size, measure).flatMap((line) =>
    measure(line, size) <= width ? [line] : piecesOf(line, width, size, measure),
  );
}

function piecesOf(word: string, width: number, size: number, measure: Measure): string[] {
  const pieces: string[] = [];
  let piece = "";
  // By whole characters: an emoji is never halved.
  for (const char of Array.from(word)) {
    if (piece.length > 0 && measure(`${piece}${char}-`, size) > width) {
      pieces.push(`${piece}-`);
      piece = char;
    } else {
      piece += char;
    }
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces;
}

/** Roboto's letters are some 0.6 of the size wide: where nothing can measure, a guess that errs wide. */
export const estimateMeasure: Measure = (text, size) => Array.from(text).length * size * 0.6;
