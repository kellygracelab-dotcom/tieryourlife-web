import type { Ranking } from "../api/rank";
import type { PublishedList } from "../api/types";

export type Preload = { kind: "list"; list: PublishedList } | { kind: "ranking"; ranking: Ranking };

export const PRELOAD_ID = "tyl-preload";

// The page function tucks the data a page will draw into the HTML, so the
// board can appear before any token has been fetched. Read once, then trusted
// only for the id it was made for, and only on the page it came with: once
// the tab has been somewhere else, the list may have changed or gone since,
// and an owner checking their Update would see the old one.
let cached: Preload | null | undefined;
let spent = false;

/** The tab left the page it was served with: from now on, every list and ranking is asked for. */
export function spendPreload(): void {
  spent = true;
}

export function readPreload(doc: Document = document): Preload | null {
  if (spent) return null;
  if (cached !== undefined) return cached;
  const text = doc.getElementById(PRELOAD_ID)?.textContent ?? null;
  cached = parsePreload(text);
  return cached;
}

export function parsePreload(text: string | null): Preload | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const { kind, list, ranking } = parsed as Partial<Record<string, unknown>>;
    if (kind === "list" && isRecord(list) && typeof list.id === "string") {
      return { kind, list: list as unknown as PublishedList };
    }
    if (kind === "ranking" && isRecord(ranking) && typeof ranking.code === "string") {
      return { kind, ranking: ranking as unknown as Ranking };
    }
    return null;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

export function preloadedList(id: string): PublishedList | null {
  const preload = readPreload();
  return preload?.kind === "list" && preload.list.id === id ? preload.list : null;
}

export function preloadedRanking(code: string): Ranking | null {
  const preload = readPreload();
  return preload?.kind === "ranking" && preload.ranking.code === code ? preload.ranking : null;
}

export function resetPreloadForTests(): void {
  cached = undefined;
  spent = false;
}
