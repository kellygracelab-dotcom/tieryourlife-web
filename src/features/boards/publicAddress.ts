import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/** The address a published list is read at by everybody: what is worth copying. */
export const publicListPath = (listId: string): string => `/l/${encodeURIComponent(listId)}`;

/**
 * One's own published board shows the list's public address in the address
 * bar, as TierMaker's does: copied from there and sent to anyone, it opens
 * the list in the Community (Danylo, 28.11.2026). The board stays where it
 * is; that address opens it again for its owner, as the list page hands
 * one's own list to one's own board. [listId] null puts the board's own
 * address back, as when the list is withdrawn while the board is open.
 *
 * Only the address shown changes, not the page the router is on. An address
 * with a query or a fragment stays as it is: the list page would not carry
 * them to the board. Nor is a window touched whose address this router does
 * not show (a test's memory router).
 */
export function usePublicAddress(listId: string | null): void {
  const { pathname, search, hash, key } = useLocation();
  const written = useRef<string | null>(null);
  useEffect(() => {
    const shown = window.location.pathname + window.location.search + window.location.hash;
    const routed = pathname + search + hash;
    if (shown !== routed && shown !== written.current) return;
    const address =
      listId !== null && search === "" && hash === "" ? publicListPath(listId) : routed;
    if (address === shown) return;
    window.history.replaceState(window.history.state, "", address);
    written.current = address;
    // `key` too: the router replacing the board's own address puts it back in the bar.
  }, [listId, pathname, search, hash, key]);
}
