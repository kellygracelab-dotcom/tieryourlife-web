import { useEffect } from "react";
import { topLayer } from "./backLayers";
import { NavigationType, useBlocker } from "react-router";

/**
 * The browser's Back, or a phone's back gesture, closes what is open over
 * the page before it leaves the page, as the app's back does. A router keeps
 * one such blocker at a time, so a page with more than one layer calls this
 * once and closes the top one. It needs the site's data router.
 */
export function useBackCloses(open: boolean, close: () => void): void {
  const blocker = useBlocker(
    ({ historyAction }) =>
      (open || topLayer() !== undefined) && historyAction === NavigationType.Pop,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    blocker.reset();
    (topLayer() ?? close)();
  }, [blocker, close]);
}
