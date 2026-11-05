import { fitText, linesOf, type Measure, type TextFit } from "../../lib/textFit";
import type { BoardSize } from "./nameFit";

/**
 * A band's room for its words at each of the board's sizes (board.css draws
 * the same): the band's width and an empty row's height, less the band's
 * padding; the letter's type, largest to smallest; the caption's, and the gap
 * between the two. The tier editor's preview is a phone's band in a shorter row.
 */
export interface BandType {
  width: number;
  height: number;
  start: number;
  floor: number;
  caption: { size: number; line: number };
  gap: number;
}

export const BAND_TYPE: Record<BoardSize | "preview", BandType> = {
  large: { width: 80, height: 98, start: 32, floor: 12, caption: { size: 11, line: 15.4 }, gap: 4 },
  medium: {
    width: 64,
    height: 84,
    start: 26,
    floor: 11,
    caption: { size: 11, line: 15.4 },
    gap: 4,
  },
  small: { width: 56, height: 78, start: 22, floor: 9, caption: { size: 9, line: 12 }, gap: 2 },
  preview: { width: 48, height: 64, start: 22, floor: 9, caption: { size: 9, line: 12 }, gap: 2 },
};

/** The letter's line, a share of its size. */
export const LABEL_LINE = 1.15;

/**
 * The letter's size on its band: as large as the band holds with every word
 * whole, under the caption's lines. A label of a letter or two keeps the
 * band's own size.
 */
export function fitLabel(
  label: string,
  caption: string | null,
  band: BandType,
  measure: Measure,
): TextFit {
  const captionLines =
    caption === null || caption.trim() === ""
      ? 0
      : linesOf(caption, band.width, band.caption.size, measure).length;
  const below = captionLines === 0 ? 0 : captionLines * band.caption.line + band.gap;
  return fitText(
    label,
    { width: band.width, height: Math.max(0, band.height - below) },
    { start: band.start, floor: band.floor, line: LABEL_LINE },
    measure,
  );
}
