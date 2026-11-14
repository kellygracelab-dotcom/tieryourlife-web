import {
  ATTRIBUTION_LIMITS,
  type EditorCredit,
  type PictureAttribution,
} from "../api/pictureAttribution";

/**
 * A house editor's own credit for a picture (CONTRACT, Editor's credit), as
 * the form keeps it: whom to name, the licence, and the page the picture
 * stands on. The licences are the ones the backend takes, in the shape it
 * stores them.
 */
export const EDITOR_LICENCES = [
  "CC0 1.0",
  "CC BY 4.0",
  "CC BY 3.0",
  "CC BY 2.5",
  "CC BY 2.0",
  "CC BY 1.0",
  "CC BY-SA 4.0",
  "CC BY-SA 3.0",
  "CC BY-SA 2.5",
  "CC BY-SA 2.0",
  "CC BY-SA 1.0",
  "Public domain",
  "Used with permission",
] as const;
export type EditorLicence = (typeof EDITOR_LICENCES)[number];

/** The form as it stands: the licence is "" until one is chosen. */
export interface CreditFields {
  author: string;
  licence: EditorLicence | "";
  link: string;
}

/** What keeps the credit from being saved, in the order the form shows its fields. */
export type CreditProblem = "needLicence" | "needLink" | "badLink" | "linkTooLong";

/**
 * A Creative Commons licence's deed, sent as its licenseUrl, so the licence is
 * a link from the moment it is saved; none for the others, whose deed the
 * backend decides (CONTRACT: none for Used with permission).
 */
export function deedOf(licence: string): string | null {
  if (licence === "CC0 1.0") return "https://creativecommons.org/publicdomain/zero/1.0/";
  const [, kind, version] = /^CC (BY|BY-SA) (\d\.\d)$/.exec(licence) ?? [];
  if (kind === undefined || version === undefined) return null;
  return `https://creativecommons.org/licenses/${kind.toLowerCase()}/${version}/`;
}

/**
 * The three pages the backend reads the author and the licence from when
 * they are left empty: a Commons file page, a Flickr photo, an iNaturalist
 * observation. The browser never fetches them itself.
 */
const READ_FROM = [
  /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^?#]+/i,
  /^https:\/\/(www\.)?flickr\.com\/photos\/[^/?#]+\/\d+(\/|$|[?#])/i,
  /^https:\/\/(www\.)?inaturalist\.org\/observations\/\d+(\/|$|[?#])/i,
];

export const readsFromPage = (link: string): boolean =>
  READ_FROM.some((shape) => shape.test(link.trim()));

/**
 * A catalogue's page for a title (CONTRACT, From a catalogue): TMDB, AniList,
 * IGDB, Steam and Open Library. A topic's picture credited to one needs no
 * licence: the backend keeps the credit as the catalogue's, linked to the
 * page. A slug after the id, a query or a trailing slash is allowed.
 */
const CATALOGUE_PAGES = [
  /^https:\/\/(www\.)?themoviedb\.org\/(movie|tv|collection)\/\d+([-/?#]|$)/i,
  /^https:\/\/anilist\.co\/(anime|manga)\/\d+([/?#]|$)/i,
  /^https:\/\/(www\.)?igdb\.com\/games\/[a-z0-9][a-z0-9-]*([/?#]|$)/i,
  /^https:\/\/store\.steampowered\.com\/app\/\d+([/?#]|$)/i,
  /^https:\/\/openlibrary\.org\/works\/OL\d+W([/?#]|$)/,
];

export const isCataloguePage = (link: string): boolean =>
  CATALOGUE_PAGES.some((shape) => shape.test(link.trim()));

/** What the form takes the credit for: a topic's picture may also be credited to a catalogue. */
export interface CreditKind {
  catalogue?: boolean;
}

const isHttpsPage = (link: string): boolean => {
  if (!link.startsWith("https://")) return false;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
};

/** What stands in the way of saving; none, and the credit can go. */
export function creditProblemsOf(fields: CreditFields, kind: CreditKind = {}): CreditProblem[] {
  const link = fields.link.trim();
  const problems: CreditProblem[] = [];
  const noLicenceNeeded =
    isHttpsPage(link) &&
    (readsFromPage(link) || (kind.catalogue === true && isCataloguePage(link)));
  if (fields.licence === "" && !noLicenceNeeded) {
    problems.push("needLicence");
  }
  if (link === "") problems.push("needLink");
  else if (link.length > ATTRIBUTION_LIMITS.url) problems.push("linkTooLong");
  else if (!isHttpsPage(link)) problems.push("badLink");
  return problems;
}

/** The credit the form makes, or null while something stands in the way. */
export function creditOfFields(fields: CreditFields, kind: CreditKind = {}): EditorCredit | null {
  if (creditProblemsOf(fields, kind).length > 0) return null;
  const author = fields.author.trim().replace(/\s+/g, " ").slice(0, ATTRIBUTION_LIMITS.author);
  const deed = fields.licence === "" ? null : deedOf(fields.licence);
  return {
    ...(author === "" ? {} : { author }),
    ...(fields.licence === "" ? {} : { license: fields.licence }),
    ...(deed === null ? {} : { licenseUrl: deed }),
    link: fields.link.trim(),
  };
}

/** One of the licences, however it was spelt; "" for any other. */
const licenceOf = (license: string | undefined): EditorLicence | "" =>
  EDITOR_LICENCES.find((one) => one.toLowerCase() === license?.trim().toLowerCase()) ?? "";

/**
 * The form for a picture's credit as it stands: the editor's own when there is
 * one, else what the picture already says of itself, to start from.
 */
export const fieldsOf = (attribution: PictureAttribution | null | undefined): CreditFields => ({
  author: attribution?.author ?? "",
  licence: licenceOf(attribution?.license),
  link: attribution?.link ?? "",
});
