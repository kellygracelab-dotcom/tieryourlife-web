/** TMDB serves each poster at fixed widths, named in its address. */
const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/;
/** Wikimedia Commons draws a file at any width asked for. */
const COMMONS = /^(https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^?]+)\?width=\d+$/;

export interface Sized {
  src: string;
  srcSet?: string;
}

/**
 * A card's picture at the size a tile shows it: a 64-pixel tile does not need
 * the 500-pixel poster the card keeps for the share image. Twice the width for
 * a sharp screen, and the stored address as it is for any other source.
 */
export function sizedFor(url: string, width: number): Sized {
  const tmdb = TMDB.exec(url);
  if (tmdb !== null) {
    const at = (w: number) => `${tmdb[1]}w${w}${tmdb[2]}`;
    const one = width <= 92 ? 92 : width <= 154 ? 154 : 185;
    const two = width * 2 <= 185 ? 185 : 342;
    return { src: at(one), srcSet: `${at(one)} 1x, ${at(two)} 2x` };
  }
  const commons = COMMONS.exec(url);
  if (commons !== null) {
    const at = (w: number) => `${commons[1]}?width=${w}`;
    return { src: at(width * 2), srcSet: `${at(width * 2)} 1x, ${at(width * 3)} 2x` };
  }
  return { src: url };
}
