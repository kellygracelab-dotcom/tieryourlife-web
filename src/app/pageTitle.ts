import { createContext, useContext, useEffect } from "react";

/** How far the page has to scroll before its title takes the brand's place in the app bar. */
export const TITLE_AFTER_PX = 96;

/** Set by a page whose title is worth keeping in view while it scrolls; the shell shows it. */
export const PageTitleContext = createContext<(title: string | null) => void>(() => undefined);

/** A page says what it is called; the title is taken back when the page goes or changes. */
export function usePageTitle(title: string | null): void {
  const set = useContext(PageTitleContext);
  useEffect(() => {
    set(title);
    return () => set(null);
  }, [set, title]);
}

/** The same as an element, for a page that knows its title only once it has loaded. */
export function PageTitle({ title }: { title: string }): null {
  usePageTitle(title);
  return null;
}
