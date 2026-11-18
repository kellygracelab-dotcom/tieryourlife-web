import {
  PICTURE_SCOPES,
  type FoundPicture,
  type PictureKind,
  type PictureScope,
  type PictureSource,
} from "../../api/pictures";
import { fill, strings } from "../../strings";

/** A place to look for pictures, as its chip says it. */
export const scopeName = (scope: PictureScope): string =>
  scope === "all"
    ? strings.search.all
    : scope === "animals"
      ? strings.new.animals
      : strings.category[scope];

/** All first, then the board's own section, then the rest, as on the phone. */
export const scopesFrom = (own: PictureScope): PictureScope[] =>
  own === "all"
    ? [...PICTURE_SCOPES]
    : ["all", own, ...PICTURE_SCOPES.filter((one) => one !== own && one !== "all")];

/** Wikidata's things and the web's pages have nothing worth a label. */
export const kindName = (kind: PictureKind): string | null =>
  kind === "thing" || kind === "web" ? null : strings.new.kinds[kind];

const SOURCE_NAMES: Record<Exclude<PictureSource, "web" | "other">, string> = {
  tmdb: "TMDB",
  anilist: "AniList",
  steam: "Steam",
  igdb: "IGDB.com",
  openlibrary: "Open Library",
  wikidata: "Wikidata",
  inaturalist: "iNaturalist",
};

/** Whose picture it is, by name; one not known yet goes unnamed. */
export const sourceName = (source: PictureSource): string | null =>
  source === "other" ? null : source === "web" ? strings.new.webSource : SOURCE_NAMES[source];

/** Whose pictures these are, in the order they first come; one not known yet goes unnamed. */
export function sourcesOf(items: readonly FoundPicture[]): string | null {
  const names = [...new Set(items.map((item) => item.source))]
    .map(sourceName)
    .filter((name): name is string => name !== null);
  return names.length === 0 ? null : fill(strings.new.fromSources, { sources: names.join(", ") });
}
