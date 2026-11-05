import { createContext, useContext, useEffect } from "react";

/** How far the page has to scroll before its title takes the brand's place in the app bar. */
export const TITLE_AFTER_PX = 96;

/** What a page is called, and whether the app bar shows it once the page's own heading has scrolled away. */
export interface PageName {
  title: string;
  inBar: boolean;
}

/** Set by a page to say what it is called; the shell names the tab with it, and may show it in the bar. */
export const PageTitleContext = createContext<(page: PageName | null) => void>(() => undefined);

/**
 * A page says what it is called; the title is taken back when the page goes
 * or changes. The browser's tab always carries it; the app bar only when the
 * title is worth keeping in view while the page scrolls (`inBar`, the default).
 */
export function usePageTitle(
  title: string | null,
  { inBar = true }: { inBar?: boolean } = {},
): void {
  const set = useContext(PageTitleContext);
  useEffect(() => {
    set(title === null ? null : { title, inBar });
    return () => set(null);
  }, [set, title, inBar]);
}

/** The same as an element, for a page that knows its title only once it has loaded. */
export function PageTitle({ title, inBar = true }: { title: string; inBar?: boolean }): null {
  usePageTitle(title, { inBar });
  return null;
}

/** The browser tab's words: the page's title before the brand, or the brand alone. */
export const documentTitleOf = (page: PageName | null, brand: string): string =>
  page === null ? brand : `${page.title} · ${brand}`;
