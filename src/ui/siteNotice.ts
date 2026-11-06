import type { SnackbarNotice } from "./Snackbar";

/**
 * A notice for something that went wrong after the page it began on was
 * left: a report that did not go through once its receipt's Done took the
 * reader back. The page's own snackbar went with the page, so the shell says
 * it instead, wherever the reader is now, as the app's messages do.
 */
let current: SnackbarNotice | null = null;
const listeners = new Set<() => void>();

export const siteNotice = (): SnackbarNotice | null => current;

export function subscribeToSiteNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Says something on whatever page is open; null takes it away. */
export function sayOnTheSite(notice: SnackbarNotice | null): void {
  current = notice;
  listeners.forEach((listener) => listener());
}
