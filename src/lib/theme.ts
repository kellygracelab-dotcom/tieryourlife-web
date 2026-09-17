export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];
export const THEME_KEY = "tyl:theme";

export const isTheme = (value: unknown): value is Theme =>
  value === "system" || value === "light" || value === "dark";

export interface ThemeStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** The colour the browser paints around the page: the paper of each scheme. */
const PAPER = { light: "#e9e7e2", dark: "#121318" } as const;

export function readTheme(store: ThemeStore): Theme {
  try {
    const kept = store.read(THEME_KEY);
    return isTheme(kept) ? kept : "system";
  } catch {
    return "system";
  }
}

/** The system choice is the absence of a choice, so it is not kept. */
export function keepTheme(store: ThemeStore, theme: Theme): void {
  try {
    if (theme === "system") store.remove(THEME_KEY);
    else store.write(THEME_KEY, theme);
  } catch {
    // Nothing to keep it in: the choice lasts the visit.
  }
}

export const systemPrefersDark = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Puts the choice on <html>, where the stylesheet reads it; the system choice
 * takes the attribute away so the media query decides. index.html does the
 * same before the first paint, from the same key.
 */
export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
  dark: boolean = systemPrefersDark(),
): void {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const shown = theme === "system" ? (dark ? "dark" : "light") : theme;
  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", PAPER[shown]);
}
