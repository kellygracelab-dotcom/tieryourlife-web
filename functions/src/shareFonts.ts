/**
 * Letters Roboto does not have. A card in Japanese, Arabic or Hindi, or with
 * an emoji, was drawn as crossed boxes. The fonts for every script would make
 * the function tens of megabytes bigger, so satori asks for what is missing
 * while it lays a card out: Google Fonts cuts a Noto font down to exactly
 * those letters (a few kilobytes), and Twemoji has each emoji as a picture.
 * A card is drawn once per version and then kept, so this costs a request or
 * two per new card, not per chat. Anything that does not come in time stays a
 * box, as before.
 */

import { readCapped } from "./capped";
import type { Fetcher } from "./shareImage";

/** A font or an emoji that takes longer than this is left out. */
export const ASSET_TIMEOUT_MS = 2500;
/** A cut-down font is a few kilobytes; a whole one is not what was asked for. */
export const FONT_MAX_BYTES = 4 * 1024 * 1024;
const EMOJI_MAX_BYTES = 256 * 1024;
/** Fonts and emoji kept per instance; the same letters come back with every card of a list. */
const CACHE_SIZE = 200;

/**
 * Satori's language codes to the Noto family that writes them. Han alone
 * comes as all four Chinese and Japanese codes at once.
 */
const FAMILIES: Record<string, string> = {
  "ja-JP": "Noto Sans JP",
  "ko-KR": "Noto Sans KR",
  "zh-CN": "Noto Sans SC",
  "zh-TW": "Noto Sans TC",
  "zh-HK": "Noto Sans HK",
  "th-TH": "Noto Sans Thai",
  "bn-IN": "Noto Sans Bengali",
  "ar-AR": "Noto Sans Arabic",
  "ta-IN": "Noto Sans Tamil",
  "ml-IN": "Noto Sans Malayalam",
  "he-IL": "Noto Sans Hebrew",
  "te-IN": "Noto Sans Telugu",
  devanagari: "Noto Sans Devanagari",
  kannada: "Noto Sans Kannada",
  symbol: "Noto Sans Symbols 2",
  math: "Noto Sans Math",
  unknown: "Noto Sans",
};

/** At most two families per run: Japanese and simplified Chinese cover nearly every Han letter. */
export function familiesFor(languageCode: string): string[] {
  const families = languageCode
    .split("|")
    .map((code) => FAMILIES[code])
    .filter((family): family is string => family !== undefined);
  return [...new Set(families)].slice(0, 2);
}

/** Twemoji's file name: code points in hex, without the variation selector unless joined. */
export function emojiFileOf(segment: string): string {
  const points = [...segment].map((char) => char.codePointAt(0) ?? 0);
  const joined = points.includes(0x200d);
  return points
    .filter((point) => joined || point !== 0xfe0f)
    .map((point) => point.toString(16))
    .join("-");
}

export const emojiUrl = (segment: string): string =>
  `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${emojiFileOf(segment)}.svg`;

export const fontCssUrl = (families: string[], text: string): string =>
  `https://fonts.googleapis.com/css2?${families
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, "+")}`)
    .join("&")}&text=${encodeURIComponent(text)}`;

export interface AddedFont {
  name: string;
  data: Buffer;
  weight: 400;
  style: "normal";
  lang?: string;
}

const cache = new Map<string, Promise<string | AddedFont[]>>();

export function resetAssetsForTests(): void {
  cache.clear();
}

async function emoji(segment: string, fetchImpl: Fetcher): Promise<string | AddedFont[]> {
  const response = await fetchImpl(emojiUrl(segment), {
    signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const svg = await readCapped(response, EMOJI_MAX_BYTES);
  if (svg === null || svg.length === 0) return [];
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}

async function fonts(languageCode: string, text: string, fetchImpl: Fetcher): Promise<AddedFont[]> {
  const families = familiesFor(languageCode);
  // Spaces and invisible marks need no font; a run of only those asks for nothing.
  const letters = [...new Set(text.replace(/[\p{Cf}\s]/gu, ""))].join("");
  if (families.length === 0 || letters === "") return [];
  const signal = AbortSignal.timeout(ASSET_TIMEOUT_MS);
  const css = await fetchImpl(fontCssUrl(families, letters), { signal });
  if (!css.ok) return [];
  // Without a browser's name Google answers with TrueType, which satori reads; woff2 it cannot.
  const sources = [
    ...(await css.text()).matchAll(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g),
  ].map((match) => match[1] ?? "");
  const lang = languageCode === "unknown" ? undefined : languageCode.split("|")[0];
  const found = await Promise.all(
    sources.map(async (source, index) => {
      const response = await fetchImpl(source, { signal });
      if (!response.ok) return null;
      const data = await readCapped(response, FONT_MAX_BYTES);
      if (data === null || data.length === 0) return null;
      const font: AddedFont = {
        name: `${families[index] ?? families[0]} ${text}`,
        data,
        weight: 400,
        style: "normal",
        ...(lang === undefined ? {} : { lang }),
      };
      return font;
    }),
  );
  return found.filter((font): font is AddedFont => font !== null);
}

/**
 * Satori's `loadAdditionalAsset`: an emoji as a picture, any other run of
 * letters as the fonts that have them. It never throws: a font that did not
 * come leaves the card drawn the old way rather than not drawn at all.
 */
export const missingAssets =
  (fetchImpl: Fetcher) =>
  (languageCode: string, segment: string): Promise<string | AddedFont[]> => {
    const key = `${languageCode}\u0000${segment}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const loading = (
      languageCode === "emoji" ? emoji(segment, fetchImpl) : fonts(languageCode, segment, fetchImpl)
    ).catch((): AddedFont[] => []);
    cache.set(key, loading);
    // Only what came is worth keeping; a miss is asked for again by the next card.
    void loading.then((asset) => {
      if (Array.isArray(asset) && asset.length === 0) cache.delete(key);
    });
    if (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return loading;
  };
