import { useCallback, useEffect, useRef, useState } from "react";

/** The tray's dots: one per this many tiles, this many at most, then "+n". An indicator, not a control. */
export const TRAY_PAGE = 5;
export const TRAY_DOTS = 8;
/** The gap between tiles in ranking.css, part of a tile's stride. */
export const TRAY_GAP = 8;

/**
 * The phone's pool, one scrolling row, and the dots under it that say which
 * page of cards is showing. Picking a card never scrolls the row: the person
 * scrolls it when they want to (Danylo, 14.11.2026).
 */
export function useTray(shownCount: number) {
  const tray = useRef<HTMLUListElement>(null);

  // Which page the tray is on: measured, because a tile's stride is the
  // stylesheet's, and scrollLeft counts from the right in Arabic.
  const pages = Math.ceil(shownCount / TRAY_PAGE);
  const [page, setPage] = useState(0);
  const readPage = useCallback(() => {
    const row = tray.current;
    const holder = row?.firstElementChild;
    if (row == null || !(holder instanceof HTMLElement)) return;
    // A row scrolled to its end shows the last page, though a wide row never
    // scrolls a whole page's stride further; anywhere else the page is the
    // card at the start's.
    const max = row.scrollWidth - row.clientWidth;
    if (max > 0 && Math.abs(row.scrollLeft) >= max - 1) {
      setPage(pages - 1);
      return;
    }
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
