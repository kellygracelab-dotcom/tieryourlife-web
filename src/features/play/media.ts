import { useSyncExternalStore } from "react";

/**
 * Play's motion is timed in script as well as drawn in CSS: a pick waits for
 * its ring, a sheet for its exit. Full motion only where the browser says
 * motion is welcome; one that cannot be asked gets the short way, so nothing
 * waits on an animation that is never drawn.
 */
export const lessMotion = (): boolean =>
  typeof window.matchMedia !== "function" ||
  !window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** A phone held sideways: the height is what is scarce, and the layouts turn (the app's isShort). */
export const SIDEWAYS = "(orientation: landscape) and (max-height: 479px)";

/** A phone upright: the result's buttons stack, the picker is a sheet from the bottom. */
export const PHONE = "(max-width: 599px)";

const matches = (query: string): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/**
 * Whether a media query holds now, followed as the window turns. For the
 * layouts that differ in what they hold, not only in how it is drawn: there
 * the markup has to know, CSS alone cannot move a button between bars.
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matches(query),
    () => false,
  );
}
