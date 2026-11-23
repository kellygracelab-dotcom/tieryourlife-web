import { useCallback, useRef, useState } from "react";

/**
 * How many of the cards a grid shows while more are to come: whole rows only,
 * so no row stands half empty above Show more (Danylo's screenshot, 23.11: 20
 * lists in eight columns left four places blank). The last page shows all it
 * has, and so does a grid with fewer cards than one row.
 */
export const fullRows = (count: number, columns: number | null, more: boolean): number =>
  !more || columns === null || columns < 1 || count < columns ? count : count - (count % columns);

/** The columns a grid lays out now, from its computed tracks; null where nothing laid it out. */
export const columnsOf = (element: Element): number | null => {
  const tracks = getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/);
  return tracks.length > 0 && tracks.every((track) => /^[\d.]+px$/.test(track))
    ? tracks.length
    : null;
};

/**
 * A ref for a grid and the number of columns it has, measured before the
 * first paint and again whenever its width changes.
 */
export function useGridColumns(): [(element: HTMLElement | null) => void, number | null] {
  const [columns, setColumns] = useState<number | null>(null);
  const watching = useRef<ResizeObserver | null>(null);
  const attach = useCallback((element: HTMLElement | null) => {
    watching.current?.disconnect();
    watching.current = null;
    if (element === null) return;
    const measure = () => setColumns(columnsOf(element));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    watching.current = new ResizeObserver(measure);
    watching.current.observe(element);
  }, []);
  return [attach, columns];
}
