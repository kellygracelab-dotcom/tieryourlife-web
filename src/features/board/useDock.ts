import { useCallback, useEffect, useState } from "react";
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
import { localStorageStore, type DraftStore } from "./draft";

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
}

const sizeOf = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * The pool's place, kept per device in two bands — a monitor and a laptop
 * window are not the same place — with the window's default where nothing
 * was chosen: under the board only on a wide, tall window.
 */
export function useDock(store: DraftStore = localStorageStore): DockState {
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

  return {
    dock: choice.dock ?? defaultDock(size.width, size.height),
    // The choice is kept as made; a shorter window shows what it can.
    rows: Math.min(choice.rows, rowsThatFit(size.height)) as DockRows,
    wide: size.width >= WIDE_BOARD_FROM,
    choose,
    resize,
  };
}
