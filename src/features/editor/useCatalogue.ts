import { useEffect, useState } from "react";
import type { CatalogueItem } from "../../api/catalogue";
import { findInCatalogue } from "../../lib/api";

export type Lookup = (query: string) => Promise<CatalogueItem[]>;

/** Shorter than this is a name being typed, not a search. */
export const MIN_LOOKUP = 2;
/** Typing pauses this long before the catalogue is asked. */
export const LOOKUP_DEBOUNCE_MS = 300;

export type CatalogueState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "ready"; query: string; items: CatalogueItem[] }
  | { status: "failed"; query: string };

/** What the catalogue says about the words in the box, a little after they stop changing. */
export function useCatalogue(query: string, lookup: Lookup = findInCatalogue): CatalogueState {
  const [answer, setAnswer] = useState<CatalogueState>({ status: "idle" });
  const wanted = query.trim();
  const asking = wanted.length >= MIN_LOOKUP;

  useEffect(() => {
    if (!asking) return;
    let current = true;
    const timer = setTimeout(() => {
      lookup(wanted).then(
        (items) => current && setAnswer({ status: "ready", query: wanted, items }),
        () => current && setAnswer({ status: "failed", query: wanted }),
      );
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted, asking, lookup]);

  if (!asking) return { status: "idle" };
  // An old answer stays on screen while the next one is on its way, unless the
  // words changed enough that it would mislead.
  if (answer.status === "ready" || answer.status === "failed") {
    return wanted.startsWith(answer.query) || answer.query.startsWith(wanted)
      ? answer
      : { status: "searching" };
  }
  return { status: "searching" };
}
