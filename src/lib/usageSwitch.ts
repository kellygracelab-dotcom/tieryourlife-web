import { useSyncExternalStore } from "react";
import { currentLocale } from "../strings";
import { localStorageStore, type KeyValueStore } from "./storage";

/**
 * Settings → Send usage statistics, on until the person turns it off (as in
 * the Android app). Kept on this device: a browser of its own says for itself.
 */
export const USAGE_OFF_KEY = "tyl:usageOff";

const listeners = new Set<() => void>();

export const usageOn = (store: KeyValueStore = localStorageStore): boolean =>
  store.read(USAGE_OFF_KEY) !== "1";

export function setUsageOn(on: boolean, store: KeyValueStore = localStorageStore): void {
  if (on) store.remove(USAGE_OFF_KEY);
  else store.write(USAGE_OFF_KEY, "1");
  listeners.forEach((listener) => listener());
}

export function subscribeToUsageSwitch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useUsageOn = (store: KeyValueStore = localStorageStore): boolean =>
  useSyncExternalStore(subscribeToUsageSwitch, () => usageOn(store));

/** The site's version, `2026.11.20-327ea66` (config/build-version.ts). */
export const SITE_VERSION: string = typeof __TYL_BUILD__ === "string" ? __TYL_BUILD__ : "dev";

/**
 * The language the site is read in and the region the browser is set to,
 * `ru-UA`; never anything from the address. A region the server would not read
 * (`419`) is left out.
 */
export function localeTag(
  language: string = currentLocale(),
  browser: readonly string[] = typeof navigator === "undefined"
    ? []
    : (navigator.languages ?? [navigator.language]),
): string | null {
  const base = (language.split("-")[0] ?? "").toLowerCase();
  if (!/^[a-z]{2,3}$/.test(base)) return null;
  const regionOf = (tag: string): string | null => {
    try {
      const region = new Intl.Locale(tag).region;
      return region !== undefined && /^[A-Z]{2}$/.test(region) ? region : null;
    } catch {
      return null;
    }
  };
  const region = browser.map(regionOf).find((one) => one !== null) ?? regionOf(language);
  return region === null || region === undefined ? base : `${base}-${region}`;
}

/**
 * The version, language and region on every call to the backend, which
 * counts what it answers by them. Statistics off, none of them goes.
 */
export function usageHeaders(store: KeyValueStore = localStorageStore): Record<string, string> {
  if (!usageOn(store)) return {};
  const headers: Record<string, string> = { "X-TYL-Client": `web/${SITE_VERSION}` };
  const locale = localeTag();
  if (locale !== null) headers["X-TYL-Locale"] = locale;
  return headers;
}
