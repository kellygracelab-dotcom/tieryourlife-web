import type { KeyValueStore } from "./storage";

/**
 * The last answer to a few questions, kept on the device so a page opens with
 * it at once and swaps in the fresh one when it comes: the sections and the
 * first page of a feed. Only the newest few are kept; anything unreadable is
 * as good as nothing.
 */
export interface Remembered<T> {
  recall(key: string): T | null;
  keep(key: string, value: T): void;
}

export function remembered<T>(store: KeyValueStore, prefix: string, most: number): Remembered<T> {
  const indexKey = `${prefix}:keys`;
  const keys = (): string[] => {
    try {
      const listed: unknown = JSON.parse(store.read(indexKey) ?? "[]");
      return Array.isArray(listed) ? listed.filter((one) => typeof one === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    recall(key) {
      const kept = store.read(`${prefix}:${key}`);
      if (kept === null) return null;
      try {
        return JSON.parse(kept) as T;
      } catch {
        return null;
      }
    },
    keep(key, value) {
      store.write(`${prefix}:${key}`, JSON.stringify(value));
      const newest = [key, ...keys().filter((one) => one !== key)];
      newest.slice(most).forEach((gone) => store.remove(`${prefix}:${gone}`));
      store.write(indexKey, JSON.stringify(newest.slice(0, most)));
    },
  };
}
