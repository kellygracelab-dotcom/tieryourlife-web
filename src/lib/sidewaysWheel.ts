/**
 * The rows that scroll sideways without a bar (the sections on a phone's
 * home, the people followed, the catalogue's places to look, the tray's
 * cards): a finger swipes them, but a mouse's wheel only turns up and down,
 * and in a narrow window they moved from the keyboard alone (Danylo, 17.11).
 * Over one of them the wheel turns it sideways; at its end the page scrolls
 * on. Only these rows: a tier's cards keep the wheel for the page.
 */
export const SIDEWAYS_ROWS = [
  ".sections-grid",
  ".following-strip__items",
  ".cards__scopes",
  ".pool__items",
].join(", ");

/**
 * The row under the pointer that can move sideways the way the wheel turns,
 * and which way along scrollLeft "on" is (-1 right to left), or null.
 */
export function sidewaysRow(
  target: EventTarget | null,
  delta: number,
): { row: HTMLElement; sign: 1 | -1 } | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>(SIDEWAYS_ROWS);
  if (row === null) return null;
  const room = row.scrollWidth - row.clientWidth;
  // Not a sideways row at this width (a grid, or a column that scrolls down).
  if (room <= 1 || row.scrollHeight - row.clientHeight > 1) return null;
  // Right to left, scrollLeft runs from 0 down to -room.
  const rtl = getComputedStyle(row).direction === "rtl";
  // How far along the row is, from its start, whichever way it reads.
  const at = rtl ? -row.scrollLeft : row.scrollLeft;
  if (delta > 0 ? at >= room - 1 : at <= 0) return null;
  return { row, sign: rtl ? -1 : 1 };
}

export function onWheel(event: WheelEvent): void {
  // A sideways gesture, Shift or a pinch is already what the person meant.
  if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const found = sidewaysRow(event.target, event.deltaY);
  if (found === null) return;
  event.preventDefault();
  const lines = event.deltaMode === 1 ? 40 : 1;
  found.row.scrollBy({ left: found.sign * event.deltaY * lines });
}

/** Once, at the start: the page's wheel, never passive, so a row can keep it. */
export function installSidewaysWheel(root: Document = document): () => void {
  root.addEventListener("wheel", onWheel, { passive: false });
  return () => root.removeEventListener("wheel", onWheel);
}
