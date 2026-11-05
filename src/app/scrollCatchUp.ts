import { useLayoutEffect } from "react";
import { useNavigationType } from "react-router";
import { sessionStorageStore } from "../lib/storage";

/** How long Back waits for a page to grow tall enough for where the person was. */
export const CATCH_UP_MS = 5000;

/** Where the page stood, per entry, kept across a reload too (Back may load the page afresh). */
const KEPT = "tyl:scroll";
const positions = new Map<string, number>(readKept());

function readKept(): [string, number][] {
  try {
    const kept: unknown = JSON.parse(sessionStorageStore.read(KEPT) ?? "[]");
    return Array.isArray(kept)
      ? kept.filter(
          (one): one is [string, number] =>
            Array.isArray(one) && typeof one[0] === "string" && typeof one[1] === "number",
        )
      : [];
  } catch {
    return [];
  }
}

/** The entry on screen now: whatever the person does next may take them away from it. */
let current: string | null = null;

/**
 * Where the page stands is noted the moment it may be left: a click or a key
 * (a link, the header's search), Back or Forward, the page going away. Not
 * on every scroll: the next page's scroll to its top, or a page still too
 * short for its place, would be noted as this one's.
 */
const note = () => {
  if (current !== null && restoring !== current) positions.set(current, window.scrollY);
};

if (typeof window !== "undefined") {
  window.addEventListener("click", note, { capture: true });
  window.addEventListener("keydown", note, { capture: true });
  window.addEventListener("popstate", note, { capture: true });
  window.addEventListener("pagehide", () => {
    note();
    try {
      void sessionStorageStore.write(KEPT, JSON.stringify([...positions].slice(-50)));
    } catch {
      // Nothing kept: Back after a reload starts where the router puts it.
    }
  });
}

/** The entry whose place is being taken again: the stops on the way are not its place. */
let restoring: string | null = null;

/** Tests start each page from nothing. */
export function forgetScrollPositionsForTests(): void {
  positions.clear();
  current = null;
}

/**
 * Back returns to where the person was, also on a page that first draws a
 * spinner while what it shows comes in: the router restores the place at
 * once, the page is still too short for it, and the browser stops near the
 * top. Here the place is kept per entry and taken again as soon as the page
 * is tall enough, unless the person has scrolled meanwhile.
 */
export function useScrollCatchUp(key: string): void {
  const navigation = useNavigationType();

  useLayoutEffect(() => {
    current = key;
  }, [key]);

  // Read in the commit itself, before any scroll the restoring sets off is heard.
  useLayoutEffect(() => {
    if (navigation !== "POP") return;
    const target = positions.get(key);
    if (target === undefined || target <= 0) return;
    restoring = key;
    const room = () => document.documentElement.scrollHeight - window.innerHeight;
    let done = false;
    let observer: ResizeObserver | null = null;
    let timer = 0;
    let held = 0;
    const stop = () => {
      done = true;
      if (restoring === key) restoring = null;
      observer?.disconnect();
      window.clearTimeout(timer);
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
        window.removeEventListener(type, stop);
      }
    };
    const tryNow = () => {
      if (done) return;
      const there = Math.abs(window.scrollY - Math.min(target, room())) < 2;
      // Held for a few frames: a transition still running may set the page back once.
      if (there && room() >= target - 2) {
        held += 1;
        if (held >= 3) stop();
        else requestAnimationFrame(tryNow);
        return;
      }
      held = 0;
      // A place at the very bottom may be a pixel short of the page that comes back.
      if (room() >= target - 2) {
        window.scrollTo(0, Math.min(target, room()));
        requestAnimationFrame(tryNow);
      }
    };
    observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => tryNow());
    // The page grows inside the root; the body may keep the window's height.
    for (const box of [document.body, ...Array.from(document.body.children)])
      observer?.observe(box);
    // At the end of the wait, as near as the page now allows.
    timer = window.setTimeout(() => {
      if (!done && window.scrollY < Math.min(target, room())) {
        window.scrollTo(0, Math.min(target, room()));
      }
      stop();
    }, CATCH_UP_MS);
    // The person moving the page themselves ends the wait.
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      window.addEventListener(type, stop, { passive: true });
    }
    // After the router's own restoration has had its go.
    requestAnimationFrame(tryNow);
    return stop;
  }, [key, navigation]);
}
