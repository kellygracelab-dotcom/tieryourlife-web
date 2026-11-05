import { useEffect } from "react";

/**
 * The page's header, a sticky row over the board on a wide screen, is as tall
 * as its words make it: two rows from 840 to about 1200 px, or with a long
 * title. Its height goes to the root as --list-head-h, so the pool's column
 * sticks under the whole header instead of under the 72 px it was sized for.
 * `slot` is the header's place for the board's bar; null when the page lends
 * none, or the window is too narrow for the header to stick.
 */
export function useHeadHeight(slot: HTMLElement | null): void {
  useEffect(() => {
    const head = slot?.closest<HTMLElement>(".list-head");
    if (head == null || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty(
        "--list-head-h",
        `${Math.ceil(head.getBoundingClientRect().height)}px`,
      ),
    );
    observer.observe(head);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--list-head-h");
    };
  }, [slot]);
}
