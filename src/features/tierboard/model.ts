import { poolOf } from "./arrange";
export type Rows = readonly (readonly number[])[];

export interface BoardState {
  readonly itemCount: number;
  readonly poolOrder?: readonly number[];
  readonly rows: Rows;
  readonly selected: number | null;
  /**
   * The pick is the board's own, the next card after one placed by a tap: a
   * tap on it keeps it picked, as the hint "tap a card, then a tier" asks,
   * where a tap on a card picked by hand puts it down.
   */
  readonly pickedByBoard?: boolean;
  readonly history: readonly Rows[];
  /**
   * The pool's order before each step of the history, where the step changed
   * it; null where it did not, or the step came from before pools had one.
   * Read from the end, alongside the history.
   */
  readonly poolHistory?: readonly (readonly number[] | null)[];
  /**
   * Where in the history a game's result stands as one step that Undo turns
   * over rather than spends: the entry there is the other side of it, the
   * board before the game or the game's arrangement, and Undo on it swaps the
   * two, so pressing it again and again goes before and after the game.
   * Moves made since are undone first, one by one.
   */
  readonly toggleAt?: number;
}

export type BoardAction =
  | { type: "select"; item: number | null }
  /**
   * `index` is the card's place among the row's other cards; without it the
   * card goes last. `among` is the pool's cards in sight, when a search hides
   * some: the next pick comes from those only.
   */
  | { type: "place"; item: number; tier: number; index?: number; among?: readonly number[] }
  /**
   * Back to the pool. `index` is the card's place among the pool's other
   * cards in sight (`among`, when a search hides some); a drag gives one, and
   * a card dragged within the pool takes its new place. Without it the card
   * goes last, or where the list had it when the pool keeps no order.
   */
  | { type: "unplace"; item: number; index?: number; among?: readonly number[] }
  | { type: "undo" }
  /** The list has other cards or tiers now (the owner's doing): the board starts over from these rows. */
  | {
      type: "reset";
      tierCount: number;
      itemCount: number;
      rows: Rows | null;
      poolOrder?: readonly number[];
    };

// Enough for a whole evening of misdrops; unbounded would keep every board
// state a stream ever produced.
export const MAX_HISTORY = 200;

export const KEYBOARD_TIERS = 9;

export function init(
  tierCount: number,
  itemCount: number,
  rows?: Rows | null,
  poolOrder?: readonly number[],
): BoardState {
  return {
    itemCount,
    ...(poolOrder === undefined ? {} : { poolOrder }),
    rows: rows ?? Array.from({ length: tierCount }, () => []),
    selected: null,
    history: [],
  };
}

const without = (rows: Rows, item: number): Rows =>
  rows.map((row) => (row.includes(item) ? row.filter((i) => i !== item) : row));

/** The pool's history as long as the history itself, nulls where it knew nothing. */
const poolsOf = (state: BoardState): (readonly number[] | null)[] => {
  const all = state.poolHistory ?? [];
  const pools = all.slice(Math.max(0, all.length - state.history.length));
  return [...Array.from({ length: state.history.length - pools.length }, () => null), ...pools];
};

const remember = (state: BoardState, rows: Rows, poolOrder?: readonly number[]): BoardState => {
  const kept = state.history.slice(-(MAX_HISTORY - 1));
  const dropped = state.history.length - kept.length;
  const { toggleAt, poolHistory: _pools, ...rest } = state;
  // A game's step pushed out of the history by a long evening is an ordinary past now.
  const at = toggleAt === undefined ? -1 : toggleAt - dropped;
  const reordered = poolOrder !== undefined && poolOrder !== state.poolOrder;
  // A pool that kept no order had the list's: Undo brings that back.
  const was = state.poolOrder ?? Array.from({ length: state.itemCount }, (_, i) => i);
  const pools = [...poolsOf(state).slice(dropped), reordered ? was : null];
  return {
    ...rest,
    ...(at >= 0 ? { toggleAt: at } : {}),
    ...(reordered ? { poolOrder } : {}),
    ...(pools.some((order) => order !== null) ? { poolHistory: pools } : {}),
    rows,
    selected: null,
    pickedByBoard: false,
    history: [...kept, state.rows],
  };
};

/**
 * The pool's order with the card at its new place: `index` counts the
 * cards in sight before it, so it goes in front of the one it was dropped
 * before, or after the last one in sight. The cards in tiers keep their
 * places in the order behind the pool's.
 */
function poolWith(
  state: BoardState,
  item: number,
  index: number | undefined,
  among?: readonly number[],
): number[] {
  const others = pool(state).filter((card) => card !== item);
  const inSight = among === undefined ? null : new Set(among);
  const visible = others.filter((card) => inSight === null || inSight.has(card));
  let at = others.length;
  if (index !== undefined) {
    const clamped = Math.min(Math.max(0, Math.trunc(index)), visible.length);
    const before = visible[clamped];
    at =
      before !== undefined
        ? others.indexOf(before)
        : visible.length === 0
          ? others.length
          : others.indexOf(visible[visible.length - 1]!) + 1;
  }
  const order = [...others.slice(0, at), item, ...others.slice(at)];
  const inPool = new Set(order);
  const rest = [
    ...new Set([
      ...(state.poolOrder ?? []),
      ...Array.from({ length: state.itemCount }, (_, i) => i),
    ]),
  ].filter((card) => !inPool.has(card));
  return [...order, ...rest];
}

const sameOrder = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((card, i) => card === b[i]);

export function reduce(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "select": {
      if (action.item !== null && !isItem(state, action.item)) return state;
      if (action.item !== null && action.item === state.selected && state.pickedByBoard === true) {
        return { ...state, pickedByBoard: false };
      }
      const selected = action.item === state.selected ? null : action.item;
      return selected === state.selected ? state : { ...state, selected, pickedByBoard: false };
    }
    case "place": {
      if (!isItem(state, action.item) || !isTier(state, action.tier)) return state;
      const row = state.rows[action.tier] ?? [];
      const was = row.indexOf(action.item);
      const others = was === -1 ? row : row.filter((item) => item !== action.item);
      const at =
        action.index === undefined
          ? was === -1
            ? others.length
            : was
          : Math.min(Math.max(0, Math.trunc(action.index)), others.length);
      // Where it already is: nothing to remember, only the pick goes.
      if (was === at)
        return state.selected === null ? state : { ...state, selected: null, pickedByBoard: false };
      const fromPool = tierOf(state, action.item) === null;
      const rows = without(state.rows, action.item).map((cards, tier) =>
        tier === action.tier ? [...cards.slice(0, at), action.item, ...cards.slice(at)] : cards,
      );
      const next = remember(state, rows);
      // Moved along its own row by keys, the card stays picked for the next step.
      if (was !== -1 && state.selected === action.item) return { ...next, selected: action.item };
      // Working through the pool by taps or keys, the next card picks itself,
      // so a whole list is one tap a card. A drag selects nothing.
      if (!fromPool || state.selected !== action.item) return next;
      const following = nextInPool(next, action.item, action.among);
      return { ...next, selected: following, pickedByBoard: following !== null };
    }
    case "unplace": {
      if (!isItem(state, action.item)) return state;
      const placed = tierOf(state, action.item) !== null;
      // A pool that keeps no order and a card with no place asked: where the list had it.
      if (action.index === undefined && state.poolOrder === undefined) {
        return placed ? remember(state, without(state.rows, action.item)) : state;
      }
      const rows = placed ? without(state.rows, action.item) : state.rows;
      const order = poolWith({ ...state, rows }, action.item, action.index, action.among);
      const was = poolOf(rows, state.itemCount, state.poolOrder);
      const now = poolOf(rows, state.itemCount, order);
      if (!placed && sameOrder(was, now)) {
        return state.selected === null ? state : { ...state, selected: null, pickedByBoard: false };
      }
      const next = remember(state, rows, order);
      // Moved along the pool by keys, the card stays picked for the next step.
      return !placed && state.selected === action.item ? { ...next, selected: action.item } : next;
    }
    case "reset":
      return init(action.tierCount, action.itemCount, action.rows, action.poolOrder);
    case "undo": {
      const previous = state.history[state.history.length - 1];
      if (previous === undefined) return state;
      // The game's step: what is on the board now becomes the other side of it.
      const turning = state.toggleAt === state.history.length - 1;
      const pools = poolsOf(state);
      const order = pools[pools.length - 1] ?? null;
      const { poolHistory: _pools, ...rest } = state;
      // A game's step turned over stays a step, with no order of its own.
      const back = turning ? [...pools.slice(0, -1), null] : pools.slice(0, -1);
      const restored: BoardState = {
        ...rest,
        ...(order === null ? {} : { poolOrder: order }),
        ...(back.some((one) => one !== null) ? { poolHistory: back } : {}),
        rows: previous,
        selected: null,
        pickedByBoard: false,
        history: turning ? [...state.history.slice(0, -1), state.rows] : state.history.slice(0, -1),
      };
      // The card that went back to the pool comes back picked: undo and
      // another tier is two taps.
      const before = new Set(pool(state));
      const returned = pool(restored).filter((item) => !before.has(item));
      return returned.length === 1
        ? { ...restored, selected: returned[0] ?? null, pickedByBoard: true }
        : restored;
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
  return poolOf(state.rows, state.itemCount, state.poolOrder);
}

/**
 * The card after this one in the pool, or the first when it was the last. A
 * card the search hides is never picked: the next key would place it unseen.
 */
function nextInPool(state: BoardState, after: number, among?: readonly number[]): number | null {
  const inSight = among === undefined ? null : new Set(among);
  const left = pool(state).filter((item) => inSight === null || inSight.has(item));
  if (state.poolOrder === undefined) return left.find((item) => item > after) ?? left[0] ?? null;
  const order = [
    ...new Set([...state.poolOrder, ...Array.from({ length: state.itemCount }, (_, i) => i)]),
  ];
  const at = order.indexOf(after);
  const available = new Set(left);
  return order.slice(at + 1).find((item) => available.has(item)) ?? left[0] ?? null;
}

export const canUndo = (state: BoardState): boolean => state.history.length > 0;

/** 1–9 as an Arabic keyboard types them (١–٩), and as a Persian one does (۱–۹). */
const EASTERN_DIGITS = ["٠", "۰"] as const;

/** The digit a key types, in any of the scripts above, or null. */
function digitOf(key: string): number | null {
  if (/^[1-9]$/.test(key)) return Number(key);
  if (key.length !== 1) return null;
  for (const zero of EASTERN_DIGITS) {
    const digit = key.charCodeAt(0) - zero.charCodeAt(0);
    if (digit >= 1 && digit <= 9) return digit;
  }
  return null;
}

/** The tier a number key stands for, or null when the key means nothing here. */
export function tierForKey(key: string, tierCount: number): number | null {
  const digit = digitOf(key);
  if (digit === null) return null;
  const tier = digit - 1;
  return tier < Math.min(tierCount, KEYBOARD_TIERS) ? tier : null;
}
