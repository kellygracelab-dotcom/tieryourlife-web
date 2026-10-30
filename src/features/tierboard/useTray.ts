import { useCallback, useEffect, useRef, useState } from "react";

/** The tray's side padding in ranking.css: a picked card stops this far from the edge. */
export const TRAY_INSET = 14;
/** The tray's dots: one per this many tiles, this many at most, then "+n". An indicator, not a control. */
export const TRAY_PAGE = 5;
export const TRAY_DOTS = 8;
/** The gap between tiles in ranking.css, part of a tile's stride. */
export const TRAY_GAP = 8;

/**
 * The phone's pool, one scrolling row: the picked card comes to its start,
 * and the dots under it say which page of cards is showing. With `settle`,
 * the row waits that long before it scrolls, and a pick undone meanwhile
 * (the second tap of a double tap) does not scroll it at all.
 */
export function useTray(selected: number | null, shownCount: number, settle = 0) {
  const tray = useRef<HTMLUListElement>(null);

  // Only the row scrolls: on a wide screen the pool may be off screen, and the
  // page must not jump to it after every key press. The distance is measured
  // on the screen and scrolled by, because where a row's scroll position
  // counts from differs between left-to-right and right-to-left, and "start"
  // is the right edge in Arabic.
  useEffect(() => {
    if (selected === null) return;
    const bring = () => {
      const row = tray.current;
      if (row === null || typeof row.scrollBy !== "function") return;
      const holder = row.querySelector<HTMLElement>(`[data-item="${selected}"]`)?.parentElement;
      if (holder == null) return;
      const card = holder.getBoundingClientRect();
      const edge = row.getBoundingClientRect();
      const rightToLeft = getComputedStyle(row).direction === "rtl";
      const left = rightToLeft
        ? card.right - edge.right + TRAY_INSET
        : card.left - edge.left - TRAY_INSET;
      row.scrollBy({ left, behavior: "smooth" });
    };
    if (settle === 0) return bring();
    const timer = setTimeout(bring, settle);
    return () => clearTimeout(timer);
  }, [selected, settle]);

  // Which page the tray is on: measured, because a tile's stride is the
  // stylesheet's, and scrollLeft counts from the right in Arabic.
  const pages = Math.ceil(shownCount / TRAY_PAGE);
  const [page, setPage] = useState(0);
  const readPage = useCallback(() => {
    const row = tray.current;
    const holder = row?.firstElementChild;
    if (row == null || !(holder instanceof HTMLElement)) return;
    const stride = holder.offsetWidth + TRAY_GAP;
    setPage(Math.min(pages - 1, Math.round(Math.abs(row.scrollLeft) / (stride * TRAY_PAGE))));
  }, [pages]);
  // Read again when the cards shown change, though the count of pages may not.
  useEffect(() => {
    readPage();
    // oxlint-disable-next-line react/exhaustive-deps -- shownCount is the reason to read, not an input
  }, [readPage, shownCount]);

  return { tray, page, pages, readPage };
}
