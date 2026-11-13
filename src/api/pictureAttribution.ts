/**
 * Where a card's picture came from and whom it names (CONTRACT,
 * PictureAttribution), beside the old `credit` text, which stays as it is.
 * The backend works it out at publication and on picture search; a client
 * keeps it on the card, wherever the card is kept, and sends it back when it
 * publishes: of it the publication reads only `link` and `originalUrl`.
 * Attribution belongs to the picture: a card whose picture goes, or changes,
 * loses it.
 */

/** The catalogues the backend names today. */
export const ATTRIBUTION_SOURCES = [
  "tmdb",
  "anilist",
  "igdb",
  "steam",
  "deezer",
  "openlibrary",
  "inaturalist",
  "wikimedia",
  "web",
] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

export interface PictureAttribution {
  /**
   * One of ATTRIBUTION_SOURCES, or a catalogue this site does not know yet
   * (see attributionOf): read it through knownSourceOf.
   */
  source: string;
  /** The person the licence asks to be named. Plain text. */
  author?: string;
  /** The licence's short name: "CC BY 4.0", "CC0 1.0", "Public domain", or Commons' own. */
  license?: string;
  licenseUrl?: string;
  /** The page about the picture, or about its title, at the source. */
  link?: string;
  /** Only while the card's imageUrl is our copy: the catalogue address it was copied from. */
  originalUrl?: string;
}

/** The backend's limits, in characters. */
export const ATTRIBUTION_LIMITS = { author: 300, license: 100, url: 500 } as const;

/** A source as a name: lowercase letters, digits, `_` and `-`, as every one of them is. */
const SOURCE_NAME = /^[a-z0-9_-]{1,40}$/;

const plain = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ").slice(0, max).trim();
  return text === "" ? null : text;
};

/**
 * An https address within the limit, or nothing. A longer one is left out
 * rather than cut: half an address leads somewhere else.
 */
const httpsAddress = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > ATTRIBUTION_LIMITS.url) return null;
  if (!value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? value : null;
  } catch {
    return null;
  }
};

/**
 * An attribution as this site keeps it: the known fields, each within its
 * limit, the addresses https only; null when there is none, or no source.
 *
 * A source this site does not know yet keeps the object, with the source as
 * it came. The backend adds catalogues before the site learns them; dropping
 * the attribution would drop the `link` and `originalUrl` a publication reads
 * back (a copy keeps its name only with its originalUrl), and the account,
 * once it knows that source, keeps it on the board. Nothing here shows a
 * source it does not know: knownSourceOf reads it as unknown.
 */
export function attributionOf(raw: unknown): PictureAttribution | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.source !== "string" || !SOURCE_NAME.test(value.source)) return null;
  const author = plain(value.author, ATTRIBUTION_LIMITS.author);
  const license = plain(value.license, ATTRIBUTION_LIMITS.license);
  const licenseUrl = httpsAddress(value.licenseUrl);
  const link = httpsAddress(value.link);
  const originalUrl = httpsAddress(value.originalUrl);
  return {
    source: value.source,
    ...(author === null ? {} : { author }),
    ...(license === null ? {} : { license }),
    ...(licenseUrl === null ? {} : { licenseUrl }),
    ...(link === null ? {} : { link }),
    ...(originalUrl === null ? {} : { originalUrl }),
  };
}

/**
 * A card's attribution, as a field to spread into it: none on a card without
 * a picture, since the attribution is the picture's.
 */
export function attributionField(
  imageUrl: string | null,
  raw: unknown,
): { attribution?: PictureAttribution } {
  if (imageUrl === null) return {};
  const attribution = attributionOf(raw);
  return attribution === null ? {} : { attribution };
}

/** The source when this site knows it; null for none and for one it does not know yet. */
export const knownSourceOf = (
  attribution: PictureAttribution | null | undefined,
): AttributionSource | null =>
  attribution !== null &&
  attribution !== undefined &&
  (ATTRIBUTION_SOURCES as readonly string[]).includes(attribution.source)
    ? (attribution.source as AttributionSource)
    : null;

/**
 * Whether a picture is TMDB's, for its notice and the card's source: by the
 * attribution, as the contract asks, and only for a hit that carries none
 * (an older backend) by the catalogue id it came with.
 */
export const isTmdbPicture = (
  attribution: PictureAttribution | null | undefined,
  catalogueId?: string | null,
): boolean =>
  attribution !== null && attribution !== undefined
    ? attribution.source === "tmdb"
    : catalogueId?.startsWith("tmdb:") === true;

/** Whether two cards name their picture the same way; both without one are the same. */
export const sameAttribution = (
  a: PictureAttribution | null | undefined,
  b: PictureAttribution | null | undefined,
): boolean => {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  return (
    a.source === b.source &&
    a.author === b.author &&
    a.license === b.license &&
    a.licenseUrl === b.licenseUrl &&
    a.link === b.link &&
    a.originalUrl === b.originalUrl
  );
};
