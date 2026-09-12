export type Rows = readonly (readonly number[])[];

export interface BoardState {
  readonly itemCount: number;
  readonly rows: Rows;
  readonly selected: number | null;
  readonly history: readonly Rows[];
}

export type BoardAction =
  | { type: "select"; item: number | null }
  | { type: "place"; item: number; tier: number }
  | { type: "unplace"; item: number }
  | { type: "undo" };

// Enough for a whole evening of misdrops; unbounded would keep every board
// state a stream ever produced.
export const MAX_HISTORY = 200;

export const KEYBOARD_TIERS = 9;

export function init(tierCount: number, itemCount: number, rows?: Rows | null): BoardState {
  return {
    itemCount,
    rows: rows ?? Array.from({ length: tierCount }, () => []),
    selected: null,
    history: [],
  };
}

const without = (rows: Rows, item: number): Rows =>
  rows.map((row) => (row.includes(item) ? row.filter((i) => i !== item) : row));

const remember = (state: BoardState, rows: Rows): BoardState => ({
  ...state,
  rows,
  selected: null,
  history: [...state.history.slice(-(MAX_HISTORY - 1)), state.rows],
});

export function reduce(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "select": {
      if (action.item !== null && !isItem(state, action.item)) return state;
      const selected = action.item === state.selected ? null : action.item;
      return selected === state.selected ? state : { ...state, selected };
    }
    case "place": {
      if (!isItem(state, action.item) || !isTier(state, action.tier)) return state;
      if (state.rows[action.tier]?.includes(action.item)) {
        return state.selected === null ? state : { ...state, selected: null };
      }
      const rows = without(state.rows, action.item).map((row, index) =>
        index === action.tier ? [...row, action.item] : row,
      );
      return remember(state, rows);
    }
    case "unplace": {
      if (tierOf(state, action.item) === null) return state;
      return remember(state, without(state.rows, action.item));
    }
    case "undo": {
      const previous = state.history[state.history.length - 1];
      if (previous === undefined) return state;
      return { ...state, rows: previous, selected: null, history: state.history.slice(0, -1) };
    }
  }
}

const isItem = (state: BoardState, item: number): boolean =>
  Number.isInteger(item) && item >= 0 && item < state.itemCount;

const isTier = (state: BoardState, tier: number): boolean =>
  Number.isInteger(tier) && tier >= 0 && tier < state.rows.length;

export function tierOf(state: BoardState, item: number): number | null {
  const index = state.rows.findIndex((row) => row.includes(item));
  return index === -1 ? null : index;
}

export function placedCount(state: BoardState): number {
  return state.rows.reduce((sum, row) => sum + row.length, 0);
}

export function pool(state: BoardState): number[] {
  const placed = new Set(state.rows.flat());
  return Array.from({ length: state.itemCount }, (_, i) => i).filter((i) => !placed.has(i));
}

export const canUndo = (state: BoardState): boolean => state.history.length > 0;

/** The tier a number key stands for, or null when the key means nothing here. */
export function tierForKey(key: string, tierCount: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const tier = Number(key) - 1;
  return tier < Math.min(tierCount, KEYBOARD_TIERS) ? tier : null;
}
