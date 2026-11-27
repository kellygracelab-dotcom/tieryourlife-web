import { useSyncExternalStore } from "react";

/*
 * Community's first screen before App Check (Danylo's yes, 27.11.2026): the
 * site's function reads the sections' tiles, people's newest lists and
 * Popular's first page as the proxy gives them to a guest, and Hosting asks
 * for them with the page itself (firebase.json, Link: preload). The front
 * page draws them at once; the live answers take their place as before.
 *
 * Small on purpose: this is in the first script, so nothing here waits on
 * the app's code. What it holds is checked where it is drawn.
 */

export const HOME_FIRST_URL = "/api/home";
/** Older than this it is not drawn: the live feed has long been asked for by then. */
export const HOME_FIRST_FOR_MS = 2 * 60 * 1000;

export interface HomeFirstAnswer {
  sections: unknown;
  fresh: unknown;
  popular: unknown;
}

let answer: HomeFirstAnswer | null = null;
let askedAt: number | null = null;
let spent = false;
const listeners = new Set<() => void>();

/**
 * Asks once, on the front page only: the same request the page's Link header
 * started, so the browser hands over what it already has.
 */
export function askHomeFirst(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<void> {
  if (askedAt !== null) return Promise.resolve();
  askedAt = now();
  return fetchImpl(HOME_FIRST_URL)
    .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
    .then(
      (body) => {
        if (spent || body === null || typeof body !== "object") return;
        const { sections, fresh, popular } = body as Partial<HomeFirstAnswer>;
        answer = { sections, fresh, popular };
        listeners.forEach((listener) => listener());
      },
      () => undefined,
    );
}

/** What came, while it may still be drawn. */
export function homeFirst(now: number = Date.now()): HomeFirstAnswer | null {
  if (spent || answer === null || askedAt === null) return null;
  return now - askedAt < HOME_FIRST_FOR_MS ? answer : null;
}

/** A list changed from here, or the visit moved on: nothing of it is drawn again. */
export function spendHomeFirst(): void {
  if (spent) return;
  spent = true;
  answer = null;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useHomeFirst(): HomeFirstAnswer | null {
  return useSyncExternalStore(
    subscribe,
    () => homeFirst(),
    () => null,
  );
}

export function resetHomeFirstForTests(): void {
  answer = null;
  askedAt = null;
  spent = false;
  listeners.clear();
}
