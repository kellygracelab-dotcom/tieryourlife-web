import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import {
  bandOf,
  defaultDock,
  keepDock,
  readDock,
  rowsThatFit,
  underFits,
  type Band,
  type Dock,
  type DockChoice,
  type DockRows,
} from "./dock";

/** From here the board has room for a column or a dock; below it the tray or the strip is the only shape. */
export const WIDE_BOARD_FROM = 840;

/** A press on the grip that moves less than this, in px, is a click rather than a drag. */
const CLICK_SLOP = 4;

export interface DockState {
  /** Where the pool sits on a wide screen: chosen on this device, or the default for the window. */
  dock: Dock;
  /** Rows of cards the dock under the board shows. */
  rows: DockRows;
  /** Whether the window is wide enough for either shape at all. */
  wide: boolean;
  /** Whether the window is tall enough to offer the dock under the board; too short, the pool stays beside. */
  canDock: boolean;
  choose: (dock: Dock) => void;
  resize: (rows: DockRows) => void;
  /**
   * For the strip on the dock's top edge: drag it to show one to four rows of
   * cards, or click it for a row more, and past the most back to one.
   */
  startResize: (event: ReactPointerEvent<HTMLElement>) => void;
  /** The same strip from the keyboard: up and down a row, Home and End to either end. */
  resizeByKey: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** The most rows the window has room for. */
  maxRows: DockRows;
}

const sizeOf = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * The pool's place, kept per device in two bands — a monitor and a laptop
 * window are not the same place — with the window's default where nothing
 * was chosen: under the board only on a wide, tall window.
 */
export function useDock(store: KeyValueStore = localStorageStore): DockState {
  const [size, setSize] = useState(sizeOf);
  useEffect(() => {
    const onResize = () => setSize(sizeOf());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [choices, setChoices] = useState<Record<Band, DockChoice>>(() => ({
    narrow: readDock(store.read, "narrow"),
    wide: readDock(store.read, "wide"),
  }));
  const band = bandOf(size.width);
  const choice = choices[band];

  const keep = useCallback(
    (next: DockChoice) => {
      keepDock(store.read, store.write, band, next);
      setChoices((all) => ({ ...all, [band]: next }));
    },
    [store, band],
  );
  const choose = useCallback(
    (dock: Dock) => keep({ dock, rows: choice.rows }),
    [keep, choice.rows],
  );
  const resize = useCallback(
    (rows: DockRows) => keep({ dock: choice.dock, rows }),
    [keep, choice.dock],
  );

  // A hundred pixels of drag is a row; never more rows than the window has room for.
  // A press that hardly moves is a click: one pointer without a drag sets the rows too.
  const shown = Math.min(choice.rows, rowsThatFit(size.height)) as DockRows;
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    const grip = event.currentTarget;
    const startY = event.clientY;
    let last = shown;
    let dragged = false;
    grip.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      if (Math.abs(startY - move.clientY) > CLICK_SLOP) dragged = true;
      const next = Math.min(
        rowsThatFit(window.innerHeight),
        Math.max(1, shown + Math.round((startY - move.clientY) / 100)),
      ) as DockRows;
      if (next === last) return;
      last = next;
      resize(next);
    };
    const onEnd = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onEnd);
    };
    const onUp = () => {
      onEnd();
      if (dragged) return;
      const most = rowsThatFit(window.innerHeight);
      resize((shown >= most ? 1 : shown + 1) as DockRows);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onEnd);
  };

  const maxRows = rowsThatFit(size.height);
  const resizeByKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const next =
      event.key === "ArrowUp"
        ? shown + 1
        : event.key === "ArrowDown"
          ? shown - 1
          : event.key === "Home"
            ? 1
            : event.key === "End"
              ? maxRows
              : null;
    if (next === null) return;
    event.preventDefault();
    const rows = Math.min(maxRows, Math.max(1, next)) as DockRows;
    if (rows !== shown) resize(rows);
  };

  // A choice of under is kept on a window too short for it, for when it is tall again.
  const canDock = underFits(size.height);
  return {
    dock: canDock ? (choice.dock ?? defaultDock(size.width, size.height)) : "beside",
    // The choice is kept as made; a shorter window shows what it can.
    rows: shown,
    wide: size.width >= WIDE_BOARD_FROM,
    canDock,
    choose,
    resize,
    startResize,
    resizeByKey,
    maxRows,
  };
}
