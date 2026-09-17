import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, keepTheme, readTheme, THEME_KEY, type ThemeStore } from "./theme";

const memory = (): ThemeStore & { kept: Map<string, string> } => {
  const kept = new Map<string, string>();
  return {
    kept,
    read: (key) => kept.get(key) ?? null,
    write: (key, value) => void kept.set(key, value),
    remove: (key) => void kept.delete(key),
  };
};

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("reads a kept choice, and takes anything else as the system's", () => {
    const store = memory();
    expect(readTheme(store)).toBe("system");
    store.kept.set(THEME_KEY, "dark");
    expect(readTheme(store)).toBe("dark");
    store.kept.set(THEME_KEY, "sepia");
    expect(readTheme(store)).toBe("system");
    const broken: ThemeStore = {
      read: () => {
        throw new Error("no storage");
      },
      write: () => undefined,
      remove: () => undefined,
    };
    expect(readTheme(broken)).toBe("system");
  });

  it("keeps light and dark, and forgets the key for the system's choice", () => {
    const store = memory();
    keepTheme(store, "dark");
    expect(store.kept.get(THEME_KEY)).toBe("dark");
    keepTheme(store, "system");
    expect(store.kept.has(THEME_KEY)).toBe(false);
  });

  it("puts the choice on the root and paints the browser to match", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    const root = document.documentElement;

    applyTheme("dark", root, false);
    expect(root.dataset.theme).toBe("dark");
    expect(meta.content).toBe("#121318");

    applyTheme("light", root, true);
    expect(root.dataset.theme).toBe("light");
    expect(meta.content).toBe("#e9e7e2");

    applyTheme("system", root, true);
    expect(root.dataset.theme).toBeUndefined();
    expect(meta.content).toBe("#121318");
    meta.remove();
  });
});
