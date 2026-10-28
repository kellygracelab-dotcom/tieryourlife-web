/**
 * The section order an admin is editing, as data: rows in order, each shown
 * or hidden. Other is always the last row and never moves or hides, so every
 * change keeps it there. Pure, so the pane's drag, its keys and its Save all
 * agree with the tests.
 */
export const LOCKED = "other";

export interface OrderRow {
  id: string;
  shown: boolean;
}

/** Moves one row to another place, keeping Other last; a move onto or past Other stops short of it. */
export function moveRow(rows: readonly OrderRow[], from: number, to: number): OrderRow[] {
  const row = rows[from];
  if (row === undefined || row.id === LOCKED) return [...rows];
  const lockedAt = rows.findIndex((one) => one.id === LOCKED);
  const last = lockedAt === -1 ? rows.length - 1 : lockedAt - (from < lockedAt ? 1 : 0);
  const target = Math.max(0, Math.min(to, last));
  const next = rows.filter((_, at) => at !== from);
  next.splice(target, 0, row);
  return next;
}

/** Shows or hides a row; Other stays shown. */
export function setShown(rows: readonly OrderRow[], id: string, shown: boolean): OrderRow[] {
  return rows.map((row) => (row.id === id && row.id !== LOCKED ? { ...row, shown } : row));
}

export interface OrderChanges {
  moved: boolean;
  /** Rows whose shown state differs from the saved one. */
  toggled: number;
  /** How many are hidden after the change. */
  hidden: number;
}

/** What differs from the saved order: whether anything moved, and what was shown or hidden. */
export function changesOf(saved: readonly OrderRow[], edited: readonly OrderRow[]): OrderChanges {
  const moved = saved.map((row) => row.id).join("\n") !== edited.map((row) => row.id).join("\n");
  const was = new Map(saved.map((row) => [row.id, row.shown]));
  const toggled = edited.filter((row) => was.get(row.id) !== row.shown).length;
  return { moved, toggled, hidden: edited.filter((row) => !row.shown).length };
}

export const isChanged = (changes: OrderChanges): boolean => changes.moved || changes.toggled > 0;

/**
 * Edits not yet saved, laid over a fresh answer from the backend: the rows
 * still there keep their edited order and shown state, a row that is new
 * (a section just created) goes before Other, and one that went is dropped.
 */
export function carried(
  fresh: readonly OrderRow[],
  saved: readonly OrderRow[],
  edited: readonly OrderRow[],
): OrderRow[] {
  if (!isChanged(changesOf(saved, edited))) return [...fresh];
  const there = new Set(fresh.map((row) => row.id));
  const known = new Set(edited.map((row) => row.id));
  const kept = edited.filter((row) => there.has(row.id) && row.id !== LOCKED);
  const added = fresh.filter((row) => !known.has(row.id) && row.id !== LOCKED);
  const locked = fresh.filter((row) => row.id === LOCKED);
  return [...kept, ...added, ...locked];
}

/** The one write a Save sends: every id in order, and the hidden ones. */
export function saveOf(rows: readonly OrderRow[]): { ids: string[]; hidden: string[] } {
  return {
    ids: rows.map((row) => row.id),
    hidden: rows.filter((row) => !row.shown).map((row) => row.id),
  };
}
