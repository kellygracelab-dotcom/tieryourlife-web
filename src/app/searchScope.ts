import { createContext, useContext, useEffect } from "react";

/**
 * Where a search starts by default: inside the section or the topic the page
 * is about, as in the app. `name` is what the field's chip says.
 */
export interface SearchScope {
  /** The section's id: its lists and its topics. */
  category: string;
  /** One topic of that section: its lists alone. */
  topic?: string;
  name: string;
}

/** Set by a page that searches inside itself; the shell's field shows it as a chip. */
export const SearchScopeContext = createContext<(scope: SearchScope | null) => void>(
  () => undefined,
);

/** Tells two scopes apart: the same place under another name is the same scope. */
export const scopeKey = (scope: SearchScope | null): string =>
  scope === null ? "" : `${scope.category}|${scope.topic ?? ""}`;

/**
 * Typing pauses this long before the search follows it: the bar's field and
 * the search page's own box alike (walkthrough item 6, Danylo, 25.11).
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The search page's address with other words, the rest of what it asks
 * (its place, its order) kept as it is; no words browse it.
 */
export function searchWordsIn(q: string, search: string): string {
  const params = new URLSearchParams(search);
  if (q === "") params.delete("q");
  else params.set("q", q);
  const rest = params.toString();
  return rest === "" ? "/search" : `/search?${rest}`;
}

/** The search page's address for these words in this place; no words browse it. */
export function searchPathOf(q: string, scope: SearchScope | null): string {
  const params = new URLSearchParams({
    ...(q !== "" ? { q } : {}),
    ...(scope !== null ? { category: scope.category } : {}),
    ...(scope?.topic !== undefined ? { topic: scope.topic } : {}),
  }).toString();
  return params === "" ? "/search" : `/search?${params}`;
}

/** A page says where its searches start; taken back when the page goes or the place changes. */
export function useSearchScope(scope: SearchScope | null): void {
  const set = useContext(SearchScopeContext);
  const category = scope?.category;
  const topic = scope?.topic;
  const name = scope?.name;
  useEffect(() => {
    set(
      category === undefined || name === undefined
        ? null
        : { category, ...(topic !== undefined ? { topic } : {}), name },
    );
    return () => set(null);
  }, [set, category, topic, name]);
}

/** The same as an element, for a page that knows its place only once it has loaded. */
export function SearchScopeMark(scope: SearchScope): null {
  useSearchScope(scope);
  return null;
}
