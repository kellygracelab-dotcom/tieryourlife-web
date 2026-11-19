import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLook,
  chooseColour,
  COLOUR_KEY,
  colourVersion,
  sourceOf,
  LOOK_KEY,
  readColour,
  showColour,
  shownColour,
  subscribeToChoices,
  subscribeToColour,
  useColourStoreForTests,
} from "./colourTheme";
import { memoryStore, type KeyValueStore } from "./storage";

const look = () => document.getElementById("tyl-colour");

let store: KeyValueStore;
beforeEach(() => {
  store = memoryStore();
  useColourStoreForTests(store);
});
afterEach(() => {
  look()?.remove();
  useColourStoreForTests(null);
});

describe("the colour a choice shows", () => {
  it("shows the site's own colours by name, and Lavender for the phone's, an unknown one or none", () => {
    expect(shownColour(null)).toBe("lavender");
    expect(shownColour({ name: "matcha", hue: null, changedAt: 1 })).toBe("matcha");
    expect(shownColour({ name: "sky", hue: 10, changedAt: 1 })).toBe("sky");
    expect(shownColour({ name: "phone", hue: 10, changedAt: 1 })).toBe("lavender");
    expect(shownColour({ name: "neon", hue: 10, changedAt: 1 })).toBe("lavender");
    expect(shownColour({ name: "custom", hue: 10, changedAt: 1 })).toBe("custom");
    expect(shownColour({ name: "custom", hue: null, changedAt: 1 })).toBe("lavender");
  });

  it("builds a ready colour from its hue, one's own from the kept hue, and Lavender from none", () => {
    expect(sourceOf({ name: "matcha", hue: 300, changedAt: 1 })).toBe("matcha");
    expect(sourceOf({ name: "peach", hue: null, changedAt: 1 })).toBe("peach");
    expect(sourceOf({ name: "sky", hue: null, changedAt: 1 })).toBe("sky");
    expect(sourceOf({ name: "custom", hue: 300, changedAt: 1 })).toBe(300);
    expect(sourceOf({ name: "lavender", hue: 300, changedAt: 1 })).toBeNull();
    expect(sourceOf({ name: "phone", hue: 300, changedAt: 1 })).toBeNull();
  });
});

describe("choosing a colour", () => {
  it("keeps it on the device, tells who shows it and who sends it, and keeps the own hue with every name", () => {
    const shown = vi.fn();
    const sent = vi.fn();
    const stopShown = subscribeToColour(shown);
    const stopSent = subscribeToChoices(sent);
    const before = colourVersion();

    chooseColour("custom", 30, 1000);
    expect(readColour()).toEqual({ name: "custom", hue: 30, changedAt: 1000 });
    chooseColour("sky", null, 2000);
    expect(readColour()).toEqual({ name: "sky", hue: 30, changedAt: 2000 });

    expect(shown).toHaveBeenCalledTimes(2);
    expect(sent).toHaveBeenLastCalledWith({ name: "sky", hue: 30, changedAt: 2000 });
    expect(colourVersion()).toBeGreaterThan(before);
    stopShown();
    stopSent();
  });

  it("reads nothing from a kept value that is not a choice", () => {
    store.write(COLOUR_KEY, "not json");
    expect(readColour()).toBeNull();
    store.write(COLOUR_KEY, JSON.stringify({ name: "sky" }));
    expect(readColour()).toBeNull();
  });
});

describe("drawing a colour", () => {
  it("puts the palette's stylesheet on the page and keeps it for the first paint; Lavender takes it away", () => {
    applyLook(":root:root{--paper:#000}");
    expect(look()?.textContent).toBe(":root:root{--paper:#000}");
    expect(store.read(LOOK_KEY)).toBe(":root:root{--paper:#000}");

    applyLook(null);
    expect(look()).toBeNull();
    expect(store.read(LOOK_KEY)).toBeNull();
  });

  it("draws a hue's palette, light and dark, and only the latest of two quick choices", async () => {
    const first = showColour({ name: "matcha", hue: null, changedAt: 1 });
    const second = showColour({ name: "peach", hue: null, changedAt: 2 });
    await Promise.all([first, second]);
    const { paletteCss } = await import("./palette");
    expect(look()?.textContent).toBe(paletteCss("peach"));
    expect(look()?.textContent).toContain('[data-theme="dark"]');

    await showColour({ name: "lavender", hue: null, changedAt: 3 });
    expect(look()).toBeNull();
  });
});
