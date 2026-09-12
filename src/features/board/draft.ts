import type { Rows } from "./model";

export interface DraftStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** The parts of a list a draft is only valid for. A republish changes them. */
export interface DraftScope {
  id: string;
  updatedAt: number;
  itemCount: number;
  tierCount: number;
}

interface Draft {
  listId: string;
  updatedAt: number;
  itemCount: number;
  rows: number[][];
}

export const draftKey = (listId: string): string => `tyl:draft:${listId}`;

// Private mode, a full disk and a browser told to block storage all throw;
// the board must work anyway, it just forgets on reload.
export const localStorageStore: DraftStore = {
  read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* forgotten on reload */
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  },
};

export function serializeDraft(scope: DraftScope, rows: Rows): string {
  const draft: Draft = {
    listId: scope.id,
    updatedAt: scope.updatedAt,
    itemCount: scope.itemCount,
    rows: rows.map((row) => [...row]),
  };
  return JSON.stringify(draft);
}

const isIndex = (value: unknown, below: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < below;

// A published snapshot has no card ids, so placements are positions and
// only make sense against the exact snapshot they were made on.
export function parseDraft(text: string | null, scope: DraftScope): Rows | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const draft = parsed as Partial<Draft>;
  if (
    draft.listId !== scope.id ||
    draft.updatedAt !== scope.updatedAt ||
    draft.itemCount !== scope.itemCount ||
    !Array.isArray(draft.rows) ||
    draft.rows.length !== scope.tierCount
  ) {
    return null;
  }
  const seen = new Set<number>();
  const rows: number[][] = [];
  for (const row of draft.rows) {
    if (!Array.isArray(row)) return null;
    for (const item of row) {
      if (!isIndex(item, scope.itemCount) || seen.has(item)) return null;
      seen.add(item);
    }
    rows.push(row as number[]);
  }
  return rows;
}

export function loadDraft(store: DraftStore, scope: DraftScope): Rows | null {
  return parseDraft(store.read(draftKey(scope.id)), scope);
}

export function saveDraft(store: DraftStore, scope: DraftScope, rows: Rows): void {
  store.write(draftKey(scope.id), serializeDraft(scope, rows));
}

export function clearDraft(store: DraftStore, listId: string): void {
  store.remove(draftKey(listId));
}
