import type { CSSProperties } from "react";
import {
  canvasMeasure,
  nameFitter,
  NAME_TYPE,
  BOARD_NAME_TYPE,
  type BoardSize,
  type NameFit,
  type NameShape,
} from "./nameFit";

export type FitName = (name: string, board: BoardSize, shape?: NameShape) => NameFit;

// Made at the first name drawn and shared by every board after it. Without a
// canvas to measure on, a name starts at its size and leans on hyphens.
let shared: FitName | null = null;
const fitShared: FitName = (name, board, shape = "poster") => {
  if (shared === null) {
    const measure = canvasMeasure();
    shared =
      measure === null
        ? (_, at, kind) => ({
            size: (kind === "board" ? BOARD_NAME_TYPE : NAME_TYPE)[at].start,
            hyphenate: true,
          })
        : nameFitter(measure);
  }
  return shared(name, board, shape);
};

interface CardNameProps {
  title: string;
  board: BoardSize;
  /** On the board's name tile (`.tile--name`), which keeps the whole name in its three lines. */
  onBoard?: boolean;
  /** How the name is fitted; measured on a canvas unless a test says otherwise. */
  fit?: FitName;
}

/**
 * A card's name where it has no picture: as large as its longest word allows.
 * A word too long even at the smallest size is hyphenated, and broken anyway
 * where the browser has no hyphens for its language, rather than cut off at
 * the tile's edge.
 */
export function CardName({ title, board, onBoard = false, fit = fitShared }: CardNameProps) {
  const { size, hyphenate } = fit(title, board, onBoard ? "board" : "poster");
  return (
    <span
      className="tile__name"
      dir="auto"
      style={{
        fontSize: size,
        hyphens: hyphenate ? "auto" : "manual",
        overflowWrap: hyphenate ? "break-word" : undefined,
      }}
    >
      {title}
    </span>
  );
}

/**
 * A pictured card's name along the picture's foot, white on a shade, two
 * lines at most (artboard 36): which picture is History and which is Art reads
 * without a hover, on a phone too. Hidden where the reader turned names off
 * (cardNames.ts); the button's own label already names it to a screen reader.
 */
/** The caption's type, in px: as set in board.css, and the smallest it shrinks to. */
export const CAPTION_SIZE = 9;
export const CAPTION_FLOOR = 7;

// The caption's longest word at its own size, on the canvas the names use.
let captionMeasure: ((word: string, size: number) => number) | null | undefined;
const widestWord = (title: string): number | null => {
  if (captionMeasure === undefined) captionMeasure = canvasMeasure();
  if (captionMeasure === null) return null;
  const measure = captionMeasure;
  return Math.max(0, ...title.split(/\s+/).map((word) => measure(word, CAPTION_SIZE)));
};

export function TileCaption({
  title,
  widest = widestWord,
}: {
  title: string;
  /** The longest word's width at 9 px; measured on a canvas unless a test says otherwise. */
  widest?: (title: string) => number | null;
}) {
  if (title.trim() === "") return null;
  const wide = widest(title);
  return (
    <span
      className="tile__caption"
      aria-hidden="true"
      dir="auto"
      // How much of the card's width one px of type takes for the longest
      // word: board.css makes the type as large as the card lets that word be
      // whole on one line (artboard 36; "Interstell / ar", 17.11).
      style={
        wide === null || wide === 0
          ? undefined
          : ({ "--caption-fit": (CAPTION_SIZE / wide).toFixed(4) } as CSSProperties)
      }
    >
      {title}
    </span>
  );
}
