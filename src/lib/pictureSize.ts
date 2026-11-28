import { CARD_WIDTHS, mediaSrc, storedPublicMedia } from "../../functions/src/publicMedia";

/** TMDB serves each poster at fixed widths, named in its address. */
const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/;
/** The widths TMDB keeps a poster at, short of the original. */
const TMDB_WIDTHS = [92, 154, 185, 342, 500, 780] as const;
const TMDB_LARGEST = 780;
/** Wikimedia Commons draws a file at any width asked for. */
const COMMONS = /^(https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^?]+)\?width=\d+$/;

export interface Sized {
  src: string;
  srcSet?: string;
  /** The width the browser picks a copy from `srcSet` for, as `sizes` says it. */
  sizes?: string;
}

/**
 * The largest box a picture is drawn in, in CSS pixels: a width, or a width and
 * a height. A picture covers its box, so a wide picture in a tall tile is as
 * high as the tile and wider than it: its longer side is what has to be sharp.
 */
export type Box = number | { width: number; height: number };

/**
 * A board's tile at its largest (ranking.css: 88 × 124 on a wide window; 64 × 90,
 * 52 × 74 and 44 × 64 elsewhere). Its pictures are picked for this box, and the
 * browser scales the choice by the screen's density.
 */
export const TILE_BOX = { width: 88, height: 124 };

/** Play's duel card at its largest (play.css: 300 wide, 300 / 422 tall). */
export const DUEL_CARD_BOX = { width: 300, height: 422 };

export const longerSide = (box: Box): number =>
  typeof box === "number" ? box : Math.max(box.width, box.height);

/**
 * The original's width in `srcSet`, past the largest copy: a browser that
 * needs more than 800 pixels takes the original, as large as it is.
 */
export const ORIGINAL_WIDTH = 2000;

/**
 * Published pictures' copies by a new address, after the Proxy drew them
 * again larger in the same files (Backend #215, 28.11; v3 after #217 fitted
 * Open Library and Commons copies to 1200 px, same day): a browser keeps a
 * copy a year (/img is immutable), and the new address is a new one to it.
 * /img reads no parameters, so any copy answers it.
 */
export const PICTURES_VERSION = "?v=3";

/**
 * A card's picture at the size it is drawn: a 64-pixel tile does not need the
 * 500-pixel poster the card keeps for the share image, and a sharp screen
 * needs twice or three times the tile (Danylo, 28.11: beautiful on any
 * device, not blurry). A published picture is offered at every copy with
 * `sizes` at its box's longer side, so the browser takes the smallest copy
 * that covers it on that screen, as the phone app does (SmallCardCopies);
 * the stored address as it is for any other source.
 */
export function sizedFor(url: string, box: Box): Sized {
  const longer = longerSide(box);
  const tmdb = TMDB.exec(url);
  if (tmdb !== null) {
    // The smallest of TMDB's widths that covers the box on that screen.
    const at = (density: number) => {
      const w = TMDB_WIDTHS.find((one) => one >= longer * density) ?? TMDB_LARGEST;
      return `${tmdb[1]}w${w}${tmdb[2]}`;
    };
    return { src: at(1), srcSet: `${at(1)} 1x, ${at(2)} 2x, ${at(3)} 3x` };
  }
  const commons = COMMONS.exec(url);
  if (commons !== null) {
    const at = (w: number) => `${commons[1]}?width=${w}`;
    return {
      src: at(longer * 2),
      srcSet: `${at(longer * 2)} 1x, ${at(longer * 3)} 2x, ${at(longer * 4)} 3x`,
    };
  }
  // A published list's picture in the site's bucket: its copies and its original.
  const stored = storedPublicMedia(url);
  if (stored !== null && stored.startsWith("published/")) {
    const copy = CARD_WIDTHS.find((w) => w >= longer * 2);
    const at = (width: number | "original") => `/img/${width}/${stored}${PICTURES_VERSION}`;
    return {
      // For a browser that reads no srcset: twice the box, as before.
      src: at(copy ?? "original"),
      srcSet: [
        ...CARD_WIDTHS.map((w) => `${at(w)} ${w}w`),
        `${at("original")} ${ORIGINAL_WIDTH}w`,
      ].join(", "),
      sizes: `${Math.ceil(longer)}px`,
    };
  }
  return { src: mediaSrc(url) };
}

/**
 * `sizes` for a picture drawn larger than its box: a cover zoomed in to its
 * focus shows a part of it, as many times wider.
 */
export function zoomedSizes(
  sizes: string | undefined,
  zoom: number | undefined,
): string | undefined {
  const px = sizes === undefined ? null : /^(\d+(?:\.\d+)?)px$/.exec(sizes);
  if (px === null || px === undefined || zoom === undefined || !(zoom > 1)) return sizes;
  return `${Math.ceil(Number(px[1]) * zoom)}px`;
}
