/** The phone app's eleven languages, in the order its picker shows them. */
export const LOCALES = [
  "en",
  "uk",
  "ru",
  "es",
  "pt-BR",
  "de",
  "fr",
  "pl",
  "tr",
  "ja",
  "ar",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_KEY = "tyl:locale";

/** Each language by its own name: a person looking for theirs may read no other. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  de: "Deutsch",
  fr: "Français",
  pl: "Polski",
  tr: "Türkçe",
  ja: "日本語",
  ar: "العربية",
};

const RIGHT_TO_LEFT: readonly Locale[] = ["ar"];

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const directionOf = (locale: Locale): "ltr" | "rtl" =>
  RIGHT_TO_LEFT.includes(locale) ? "rtl" : "ltr";

export interface LocaleStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** What the person chose on this device, or nothing: the browser's languages decide then. */
export function readLocale(store: LocaleStore): Locale | null {
  try {
    const kept = store.read(LOCALE_KEY);
    return isLocale(kept) ? kept : null;
  } catch {
    return null;
  }
}

export function keepLocale(store: LocaleStore, locale: Locale): void {
  try {
    store.write(LOCALE_KEY, locale);
  } catch {
    // Nothing to keep it in: the choice lasts until the page is closed.
  }
}

/**
 * The language to open in: the one chosen here, else the first of the
 * browser's that the site speaks, else English. A browser says "pt-PT" or
 * "uk-UA"; the language alone is enough to match, and only among the
 * languages that actually have a dictionary.
 */
export function pickLocale(
  kept: Locale | null,
  wanted: readonly string[],
  available: readonly Locale[],
): Locale {
  if (kept !== null && available.includes(kept)) return kept;
  for (const tag of wanted) {
    const exact = available.find((locale) => locale.toLowerCase() === tag.toLowerCase());
    if (exact !== undefined) return exact;
    const language = tag.split("-")[0]?.toLowerCase();
    const close = available.find((locale) => locale.split("-")[0]?.toLowerCase() === language);
    if (close !== undefined) return close;
  }
  return DEFAULT_LOCALE;
}

/** The language and the direction go on <html>, where the browser, a reader and the stylesheet look. */
export function applyLocale(locale: Locale, root: HTMLElement = document.documentElement): void {
  root.lang = locale;
  root.dir = directionOf(locale);
}
