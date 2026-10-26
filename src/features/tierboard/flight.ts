/** The tray spec's flight: 220 ms on this curve, from where the card was to where it is. */
export const FLIGHT_MS = 220;
export const FLIGHT_EASING = "cubic-bezier(.2,.7,.3,1)";
/** For someone who asked their system for less motion: a fade instead. */
export const FADE_MS = 90;

export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The tile already sits in its row when this runs; it is drawn where it was
 * in the tray and settles where it is — a FLIP, so nothing is measured
 * twice and the row's height never moves. Any animation the stylesheet
 * started on the tile (its landing) gives way.
 */
export function flyIn(tile: HTMLElement, from: DOMRect, reduced = prefersReducedMotion()): void {
  if (typeof tile.animate !== "function") return;
  for (const running of tile.getAnimations?.() ?? []) running.cancel();
  if (reduced) {
    tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
    return;
  }
  const to = tile.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = to.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 ? from.height / to.height : 1;
  tile.animate(
    [
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: "top left", transform: "none" },
    ],
    { duration: FLIGHT_MS, easing: FLIGHT_EASING },
  );
}
