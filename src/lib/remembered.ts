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
  /** Drops every answer the test says is no longer so. */
  forget(test: (value: T) => boolean): void;
}

/**
 * `read` turns what was kept back into a value, or throws or says null for
 * anything it cannot use: an answer kept by an older or newer site, or a
 * store somebody changed. Such a copy is dropped, never handed on, since a
 * page drawn from it would fail on every visit until the site data is cleared.
 */
export function remembered<T>(
  store: KeyValueStore,
  prefix: string,
  most: number,
  read: (kept: unknown) => T | null,
): Remembered<T> {
  const indexKey = `${prefix}:keys`;
  const keys = (): string[] => {
    try {
      const listed: unknown = JSON.parse(store.read(indexKey) ?? "[]");
      return Array.isArray(listed) ? listed.filter((one) => typeof one === "string") : [];
    } catch {
      return [];
    }
  };
  const recall = (key: string): T | null => {
    const kept = store.read(`${prefix}:${key}`);
    if (kept === null) return null;
    try {
      const value = read(JSON.parse(kept));
      if (value !== null) return value;
    } catch {
      // Unusable, as below.
    }
    store.remove(`${prefix}:${key}`);
    return null;
  };
  return {
    recall,
    forget(test) {
      const listed = keys();
      const gone = listed.filter((key) => {
        const value = recall(key);
        return value === null || test(value);
      });
      if (gone.length === 0) return;
      gone.forEach((key) => store.remove(`${prefix}:${key}`));
      store.write(indexKey, JSON.stringify(listed.filter((key) => !gone.includes(key))));
    },
    keep(key, value) {
      store.write(`${prefix}:${key}`, JSON.stringify(value));
      const newest = [key, ...keys().filter((one) => one !== key)];
      newest.slice(most).forEach((gone) => store.remove(`${prefix}:${gone}`));
      store.write(indexKey, JSON.stringify(newest.slice(0, most)));
    },
  };
}
