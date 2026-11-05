import type { PublishedList } from "../../api/types";
import type { KeyValueStore } from "../../lib/storage";
import type { Rows } from "./model";

/** The parts of a list a draft is only valid for. A republish changes them. */
export interface DraftScope {
  id: string;
  updatedAt: number;
  itemCount: number;
  tierCount: number;
}

/**
 * The words Mine's tiers wear, one per tier: a reader's, when Mine started
 * from their placing (the app's Mine takes their tiers), or null where a
 * tier keeps the list's own.
 */
export type TierLabels = readonly (string | null)[];

interface Draft {
  listId: string;
  updatedAt: number;
  itemCount: number;
  rows: number[][];
  /** Left out while every tier keeps the list's own words. */
  labels?: (string | null)[];
}

/** The scope of a list's draft: the parts a republish changes. */
export const scopeOf = (list: PublishedList): DraftScope => ({
  id: list.id,
  updatedAt: list.updatedAt,
  itemCount: list.items.length,
  tierCount: list.tiers.length,
});

export const draftKey = (listId: string): string => `tyl:draft:${listId}`;

/** A tier's word from somebody, or null: a blank one is no word. */
const wordOf = (label: unknown): string | null =>
  typeof label === "string" && label.trim() !== "" ? label : null;

/** Labels worth keeping: at least one tier has a word of somebody's. */
const someWords = (labels: TierLabels | null | undefined): labels is TierLabels =>
  labels != null && labels.some((label) => wordOf(label) !== null);

export function serializeDraft(scope: DraftScope, rows: Rows, labels?: TierLabels | null): string {
  const draft: Draft = {
    listId: scope.id,
    updatedAt: scope.updatedAt,
    itemCount: scope.itemCount,
    rows: rows.map((row) => [...row]),
    ...(someWords(labels) ? { labels: labels.map(wordOf) } : {}),
  };
  return JSON.stringify(draft);
}

const isIndex = (value: unknown, below: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < below;

/** The draft as it was stored, when it is one for this version of the list. */
function draftFor(text: string | null, scope: DraftScope): Partial<Draft> | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const draft = parsed as Partial<Draft>;
  return draft.listId === scope.id && draft.updatedAt === scope.updatedAt ? draft : null;
}

// A published snapshot has no card ids, so placements are positions and
// only make sense against the exact snapshot they were made on.
export function parseDraft(text: string | null, scope: DraftScope): Rows | null {
  const draft = draftFor(text, scope);
  if (
    draft === null ||
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

export function loadDraft(store: KeyValueStore, scope: DraftScope): Rows | null {
  return parseDraft(store.read(draftKey(scope.id)), scope);
}

/** The draft once anything in it is placed: a board only opened keeps empty rows, and that is nobody's ranking. */
export function loadPlacedDraft(store: KeyValueStore, scope: DraftScope): Rows | null {
  const rows = loadDraft(store, scope);
  return rows !== null && rows.some((row) => row.length > 0) ? rows : null;
}

/** The words Mine's tiers wear, or null while they are the list's own. */
export function loadDraftLabels(store: KeyValueStore, scope: DraftScope): TierLabels | null {
  const labels: unknown = draftFor(store.read(draftKey(scope.id)), scope)?.labels;
  return Array.isArray(labels) && labels.length === scope.tierCount && someWords(labels)
    ? labels.map(wordOf)
    : null;
}

/**
 * The rows, and the tiers' words when they are given. Left out, the words
 * the draft already wears stay with it, so a move on the board keeps them.
 */
export function saveDraft(
  store: KeyValueStore,
  scope: DraftScope,
  rows: Rows,
  labels?: TierLabels | null,
): void {
  const words = labels === undefined ? loadDraftLabels(store, scope) : labels;
  store.write(draftKey(scope.id), serializeDraft(scope, rows, words));
}

export function clearDraft(store: KeyValueStore, listId: string): void {
  store.remove(draftKey(listId));
}

/** The list under the words Mine's tiers wear; the list itself while they are its own. */
export function withLabels(list: PublishedList, labels: TierLabels | null): PublishedList {
  if (labels === null) return list;
  return {
    ...list,
    tiers: list.tiers.map((tier, index) => {
      const label = wordOf(labels[index]);
      return label === null ? tier : { ...tier, label };
    }),
  };
}
