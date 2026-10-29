import type { SectionChanges } from "../../api/admin";
import type { ApiError } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import { CATEGORIES, isCategory } from "../../api/types";
import type { Size } from "../../lib/framing";
import { SECTION_PICTURE_MIN } from "../../lib/pictures";
import type { KeyValueStore } from "../../lib/storage";
import { isSectionIcon, OTHER, type Section, type SectionIcon } from "./model";

/** A section's picture is a 16:10 tile, on the phone and here. */
export const SECTION_ASPECT = 16 / 10;
/** The backend's bounds for a name, counted in characters. */
export const SECTION_NAME_MIN = 2;
export const SECTION_NAME_MAX = 24;
/** One account cannot fill the queue while its first proposal is still being read. */
export const PENDING_MAX = 3;
/** Nor propose more than this in a rolling day, withdrawn ones counted (429 TOO_MANY_PROPOSALS). */
export const PROPOSALS_PER_DAY = 10;
/** The name is asked about once typing has stopped this long. */
export const NAME_CHECK_MS = 400;

/** Spaces collapsed and trimmed, as the backend keeps a name. */
export const tidySectionName = (name: string): string => name.replace(/\s+/g, " ").trim();

/** Two to twenty-four characters with a letter or a digit in them: the backend's own rule. */
export function isSectionName(name: string): boolean {
  const tidy = tidySectionName(name);
  const length = [...tidy].length;
  return length >= SECTION_NAME_MIN && length <= SECTION_NAME_MAX && /[\p{L}\p{N}]/u.test(tidy);
}

/** The person's own proposals still waiting for a moderator. */
export const myWaiting = (sections: readonly Section[], uid: string | null): Section[] =>
  sections.filter(
    (one) => one.status === "pending" && (one.proposerUid === null || one.proposerUid === uid),
  );

/**
 * The sections lists can be filed under while a proposal waits: the approved
 * ones in the order the owner gave them, Other last.
 */
export function fileUnderChoices(sections: readonly Section[]): Section[] {
  const builtInAt = (id: string) => (isCategory(id) ? CATEGORIES.indexOf(id) : CATEGORIES.length);
  return sections
    .filter((one) => one.status === "approved")
    .sort(
      (a, b) =>
        Number(a.id === OTHER) - Number(b.id === OTHER) ||
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        a.approvedAt - b.approvedAt ||
        builtInAt(a.id) - builtInAt(b.id),
    );
}

/**
 * The width a picture is named by when it is too small to be a section's, or
 * null when it will do: it must give a 16:10 crop of at least 960 × 600.
 * Usually the width is what falls short; a long, low panorama is named by the
 * width its 16:10 crop would have.
 */
export function shortOf(size: Size): number | null {
  if (size.width < SECTION_PICTURE_MIN.width) return size.width;
  if (size.height < SECTION_PICTURE_MIN.height) {
    return Math.floor(size.height * SECTION_ASPECT);
  }
  return null;
}

/** What a refusal means to the form, by where it is shown. */
export type Trouble =
  | { kind: "nameTaken"; id: string | null }
  | { kind: "badName" }
  | { kind: "tooSmall" }
  | { kind: "notImage" }
  | { kind: "notCropped" }
  | { kind: "tooMany" }
  | { kind: "tooManyToday" }
  | { kind: "banned" }
  | { kind: "failed" };

/**
 * The proxy's codes (docs/sections-api.md, 3) placed where Claude Design's
 * table puts them; anything it does not name is the failure bar's, a
 * picture that went missing on the way included, since another try sends it
 * again.
 */
export function troubleOf(error: ApiError): Trouble {
  if (error.kind === "banned") return { kind: "banned" };
  if (error.kind === "tooManyRequests") return { kind: "tooManyToday" };
  if (error.kind !== "invalid") return { kind: "failed" };
  switch (error.code) {
    case "NAME_TAKEN":
      return { kind: "nameTaken", id: error.id ?? null };
    case "BAD_NAME":
      return { kind: "badName" };
    case "TOO_MANY_PENDING":
      return { kind: "tooMany" };
    case "BAD_PICTURE":
      if (error.why === "too_small") return { kind: "tooSmall" };
      if (error.why === "not_16_10") return { kind: "notCropped" };
      if (error.why === "not_image") return { kind: "notImage" };
      return { kind: "failed" };
    default:
      return { kind: "failed" };
  }
}

/** A proposal that could not go, kept for the next time the form opens in this tab. */
export interface KeptProposal {
  name: string;
  icon: SectionIcon;
  fileUnder: string;
  /** The crop as it was sent, as a data: address; null when it would not fit. */
  picture: string | null;
}

export const KEPT_KEY = "tyl:sectionProposal";
/** Apart from the words, so a picture too big for the tab's storage loses only itself. */
export const KEPT_PICTURE_KEY = "tyl:sectionProposal:picture";

export function keepProposal(store: KeyValueStore, kept: KeptProposal): void {
  const { picture, ...words } = kept;
  store.write(KEPT_KEY, JSON.stringify(words));
  if (picture === null) store.remove(KEPT_PICTURE_KEY);
  else store.write(KEPT_PICTURE_KEY, picture);
}

export function readKeptProposal(store: KeyValueStore): KeptProposal | null {
  const text = store.read(KEPT_KEY);
  if (text === null) return null;
  let words: unknown;
  try {
    words = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof words !== "object" || words === null) return null;
  const { name, icon, fileUnder } = words as Record<string, unknown>;
  if (typeof name !== "string" || typeof fileUnder !== "string") return null;
  const picture = store.read(KEPT_PICTURE_KEY);
  return {
    name,
    icon: isSectionIcon(icon) ? icon : "category",
    fileUnder,
    picture: picture !== null && picture.startsWith("data:image/") ? picture : null,
  };
}

export function forgetProposal(store: KeyValueStore): void {
  store.remove(KEPT_KEY);
  store.remove(KEPT_PICTURE_KEY);
}

/** Translations as typed, by language: an empty one is left out, and the name as typed shows. */
export function translationsOf(
  names: Readonly<Partial<Record<string, string>>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names)
      .map(([locale, text]) => [locale, tidySectionName(text ?? "")] as const)
      .filter(([, text]) => text !== ""),
  );
}

const sameTranslations = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** The words and icon of a section as the form edits them. */
export interface SectionWords {
  name: string;
  names: Record<string, string>;
  icon: SectionIcon;
}

/**
 * A section's words as stored, for an edit to start from; one the backend
 * has not named yet starts from how the site draws it.
 */
export function wordsOf(stored: SectionStats, drawn: Pick<Section, "name" | "icon">): SectionWords {
  return {
    name: stored.name ?? drawn.name,
    names: translationsOf(stored.names ?? {}),
    icon: isSectionIcon(stored.icon)
      ? stored.icon
      : isSectionIcon(drawn.icon)
        ? drawn.icon
        : "category",
  };
}

/** What an edit sends: only the fields that differ from where it started, the picture apart. */
export function changesOf(start: SectionWords, now: SectionWords): SectionChanges {
  const changes: SectionChanges = {};
  const name = tidySectionName(now.name);
  if (name !== tidySectionName(start.name)) changes.name = name;
  const names = translationsOf(now.names);
  if (!sameTranslations(names, translationsOf(start.names))) changes.names = names;
  if (now.icon !== start.icon) changes.icon = now.icon;
  return changes;
}
