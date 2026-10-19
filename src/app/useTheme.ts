import { useEffect, useState } from "react";
import { type KeyValueStore, localStorageStore } from "../lib/storage";
import { applyTheme, keepTheme, readTheme, type Theme } from "../lib/theme";

/** The person's choice of scheme, kept on this device and applied to the page. */
export function useTheme(store: KeyValueStore = localStorageStore) {
  const [theme, setTheme] = useState<Theme>(() => readTheme(store));

  useEffect(() => {
    applyTheme(theme);
    // With no choice of their own, the browser's colour follows the system.
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [theme]);

  const choose = (next: Theme) => {
    keepTheme(store, next);
    setTheme(next);
  };

  return { theme, choose };
}
