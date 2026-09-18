import { DEFAULT_LOCALE, isLocale, type Locale } from "../lib/locale";
import { en } from "./en";

/**
 * The forms a count may need. English has two; Ukrainian, Russian and Polish
 * have four and Arabic six. `other` is the one every language has, and the one
 * a missing form falls back to.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * A group of plural forms is told by ALL its keys being plural categories, not
 * by having an `other`: the categories of a list have an "Other" of their own.
 */
type IsPlural<T> = T extends { other: string }
  ? keyof T extends keyof PluralForms
    ? true
    : false
  : false;

/** The shape of English with its literal texts loosened, so another language fits it. */
type Widen<T> =
  IsPlural<T> extends true
    ? PluralForms
    : T extends string
      ? string
      : { [K in keyof T]: Widen<T[K]> };

export type Strings = Widen<typeof en>;

/** A translation may lag behind English; what it lacks is read from English. */
export type Translation = { [K in keyof Strings]?: PartialDeep<Strings[K]> };

type PartialDeep<T> = T extends PluralForms
  ? PluralForms
  : T extends string
    ? string
    : { [K in keyof T]?: PartialDeep<T[K]> };

/**
 * Read where it is used, never copied at import time by anything that loads
 * before the language is known: main.tsx sets it and only then imports the app.
 */
export let strings: Strings = en;

let locale: Locale = DEFAULT_LOCALE;
let numbers = new Intl.NumberFormat(DEFAULT_LOCALE);
let rules = new Intl.PluralRules(DEFAULT_LOCALE);

export const currentLocale = (): Locale => locale;

/** Every language but English is a file of its own, fetched only by the people who read it. */
const files = import.meta.glob<{ default: Translation }>("./locales/*.ts");

const localeOfFile = (path: string): string => path.replace("./locales/", "").replace(".ts", "");

/** English, and whatever has a dictionary: a language without one is not offered. */
export const availableLocales = (): Locale[] => [
  DEFAULT_LOCALE,
  ...Object.keys(files).map(localeOfFile).filter(isLocale),
];

const PLURAL_KEYS = new Set(["zero", "one", "two", "few", "many", "other"]);

// The same test as the type above: every key a plural category, `other` among them.
const isPlural = (value: unknown): value is PluralForms =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PluralForms).other === "string" &&
  Object.keys(value).every((key) => PLURAL_KEYS.has(key));

/** English underneath, the translation on top, leaf by leaf; a plural is taken whole. */
export function overlay<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (typeof base === "string") return (typeof over === "string" ? over : base) as T;
  if (isPlural(base)) return (isPlural(over) ? over : base) as T;
  if (typeof base !== "object" || base === null || typeof over !== "object") return base;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    result[key] = overlay(
      (base as Record<string, unknown>)[key],
      (over as Record<string, unknown>)[key],
    );
  }
  return result as T;
}

export function setStrings(next: Locale, translation: Translation | null): void {
  locale = next;
  numbers = new Intl.NumberFormat(next);
  rules = new Intl.PluralRules(next);
  strings = translation === null ? en : overlay<Strings>(en, translation);
}

/** Fetches a language's dictionary and makes it the one in use. English needs no fetching. */
export async function loadStrings(next: Locale): Promise<void> {
  const load = files[`./locales/${next}.ts`];
  if (next === DEFAULT_LOCALE || load === undefined) return setStrings(DEFAULT_LOCALE, null);
  try {
    setStrings(next, (await load()).default);
  } catch {
    // A dictionary that would not come is no reason to show nothing.
    setStrings(DEFAULT_LOCALE, null);
  }
}

export const formatCount = (n: number): string => numbers.format(n);

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function plural(forms: PluralForms, n: number): string {
  return fill(forms[rules.select(n)] ?? forms.other, { n: formatCount(n) });
}
