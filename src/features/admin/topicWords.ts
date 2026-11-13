import type { EditorCredit } from "../../api/pictureAttribution";
import { LOCALES, type Locale } from "../../lib/locale";
import { translationsOf } from "../sections/proposal";

/** A topic's name is written in English; the other ten languages are translations of it. */
export const TOPIC_LOCALES: readonly Locale[] = LOCALES.filter((locale) => locale !== "en");

/** The translations of a topic as the form starts from them: the ten languages, none empty. */
export function topicNamesOf(
  names: Readonly<Partial<Record<string, string>>> | undefined,
): Record<string, string> {
  const tidy = translationsOf(names ?? {});
  return Object.fromEntries(
    TOPIC_LOCALES.flatMap((one) => (tidy[one] === undefined ? [] : [[one, tidy[one]]])),
  );
}

/** A new topic sends the translations it has, none at all when it has none. */
export function newNames(now: Readonly<Record<string, string>>): Record<string, string> | null {
  const names = topicNamesOf(now);
  return Object.keys(names).length === 0 ? null : names;
}

/**
 * An edit sends only the languages that differ from where it started; a
 * language emptied is sent as "", which takes its translation away. Null when
 * nothing differs.
 */
export function changedNames(
  start: Readonly<Record<string, string>>,
  now: Readonly<Record<string, string>>,
): Record<string, string> | null {
  const was = topicNamesOf(start);
  const is = topicNamesOf(now);
  const changed = TOPIC_LOCALES.filter((one) => (was[one] ?? "") !== (is[one] ?? ""));
  return changed.length === 0
    ? null
    : Object.fromEntries(changed.map((one) => [one, is[one] ?? ""]));
}

/** Two credits that say the same thing. */
export const sameCredit = (a: EditorCredit | null, b: EditorCredit | null): boolean =>
  a === null || b === null
    ? a === b
    : a.author === b.author &&
      a.license === b.license &&
      a.licenseUrl === b.licenseUrl &&
      a.link === b.link;
