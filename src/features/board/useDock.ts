import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import {
  bandOf,
  defaultDock,
  keepDock,
  readDock,
  rowsThatFit,
  type Band,
  type Dock,
  type DockChoice,
  type DockRows,
} from "./dock";

/** From here the board has room for a column or a dock; below it the tray or the strip is the only shape. */
export const WIDE_BOARD_FROM = 840;

export interface DockState {
  /** Where the pool sits on a wide screen: chosen on this device, or the default for the window. */
  dock: Dock;
  /** Rows of cards the dock under the board shows. */
  rows: DockRows;
  /** Whether the window is wide enough for either shape at all. */
  wide: boolean;
  choose: (dock: Dock) => void;
  resize: (rows: DockRows) => void;
  /** For the 6 px strip on the dock's top edge: drag it to show one to four rows of cards. */
  startResize: (event: ReactPointerEvent<HTMLElement>) => void;
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
  const shown = Math.min(choice.rows, rowsThatFit(size.height)) as DockRows;
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    const grip = event.currentTarget;
    const startY = event.clientY;
    let last = shown;
    grip.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
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
      grip.removeEventListener("pointerup", onEnd);
      grip.removeEventListener("pointercancel", onEnd);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onEnd);
    grip.addEventListener("pointercancel", onEnd);
  };

  return {
    dock: choice.dock ?? defaultDock(size.width, size.height),
    // The choice is kept as made; a shorter window shows what it can.
    rows: shown,
    wide: size.width >= WIDE_BOARD_FROM,
    choose,
    resize,
    startResize,
  };
}
