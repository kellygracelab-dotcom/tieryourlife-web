import { colourChoiceOf, type ColourChoice } from "../api/settings";
import { localStorageStore, type KeyValueStore } from "./storage";
import { paintAround } from "./theme";

export { colourChoiceOf, type ColourChoice };

/**
 * The colour the site is drawn in (artboards 58–59, 18.11.2026), beside the
 * light, dark or system scheme: Lavender, today's hand-made palette, or a
 * palette built from one hue, a ready one or the person's own. The account
 * keeps the choice (`GET /boards/settings`), the same on the phone; the
 * phone's own wallpaper colours ("phone") are the phone's alone, and the site
 * shows them as Lavender, as it does a name it does not know.
 */
export type ColourName = "lavender" | "matcha" | "peach" | "sky" | "phone" | "custom";

/** What the site offers, in the design's order. */
export const SITE_COLOURS = ["lavender", "matcha", "peach", "sky", "custom"] as const;
export type SiteColour = (typeof SITE_COLOURS)[number];

/**
 * The ready colours' main hues (the vectors' palettes.primary.hue): Your
 * colour's slider opens on them. Their palettes are fixed tables (palette.ts).
 */
export const PRESET_HUES = { matcha: 136, peach: 41, sky: 220 } as const;

/** Where the own colour's slider starts before one was ever chosen, as on the phone. */
export const FIRST_OWN_HUE = 265;

export const COLOUR_KEY = "tyl:colour";
/** The palette's stylesheet as last drawn, for index.html to put on before the first paint. */
export const LOOK_KEY = "tyl:colour-look";
const STYLE_ID = "tyl-colour";

/** The colour the site shows for a choice: Lavender for "phone", a name it does not know, or a custom without its hue. */
export function shownColour(choice: ColourChoice | null): SiteColour {
  const name = choice?.name;
  if (name === "custom") return choice?.hue === null ? "lavender" : "custom";
  return (SITE_COLOURS as readonly string[]).includes(name ?? "")
    ? (name as SiteColour)
    : "lavender";
}

/** What a choice is drawn from: a ready colour's table, one's own hue, or null for Lavender's hand-made palette. */
export function sourceOf(choice: ColourChoice | null): "matcha" | "peach" | "sky" | number | null {
  const shown = shownColour(choice);
  if (shown === "lavender") return null;
  if (shown === "custom") return choice?.hue ?? null;
  return shown;
}

let store: KeyValueStore = localStorageStore;
const listeners = new Set<() => void>();
let version = 0;

/** Tests keep the choice in a store of their own; null puts the browser's back. */
export function useColourStoreForTests(test: KeyValueStore | null): void {
  store = test ?? localStorageStore;
  version++;
}

/** The choice this device keeps, or null when it never had one (Lavender). */
export function readColour(): ColourChoice | null {
  try {
    const kept = store.read(COLOUR_KEY);
    return kept === null ? null : colourChoiceOf(JSON.parse(kept));
  } catch {
    return null;
  }
}

/** Keeps a choice on this device and tells whoever shows it. */
export function keepColour(choice: ColourChoice): void {
  try {
    store.write(COLOUR_KEY, JSON.stringify(choice));
  } catch {
    // Nothing to keep it in: the choice lasts the visit.
  }
  version++;
  listeners.forEach((listener) => listener());
}

export function subscribeToColour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const colourVersion = (): number => version;

/** Puts the palette's stylesheet on the page, or takes it away for Lavender, and keeps it for the next first paint. */
export function applyLook(css: string | null, doc: Document = document): void {
  const old = doc.getElementById(STYLE_ID);
  if (css === null) old?.remove();
  else {
    const style = old ?? doc.head.appendChild(doc.createElement("style"));
    style.id = STYLE_ID;
    style.textContent = css;
  }
  if (doc.documentElement) paintAround(doc.documentElement);
  try {
    if (css === null) store.remove(LOOK_KEY);
    else store.write(LOOK_KEY, css);
  } catch {
    // The next visit builds it again.
  }
}

/**
 * Draws the site in a choice: Lavender at once; a hue once its palette is
 * built, which needs the colour library, fetched the first time only.
 */
let drawing = 0;

export async function showColour(choice: ColourChoice | null, doc: Document = document) {
  const turn = ++drawing;
  const source = sourceOf(choice);
  if (source === null) {
    applyLook(null, doc);
    return;
  }
  const { paletteCss } = await import("./palette");
  // Another choice came meanwhile: only the latest is drawn.
  if (turn === drawing) applyLook(paletteCss(source), doc);
}

const chosenListeners = new Set<(choice: ColourChoice) => void>();

/** Hears each choice the person makes here, for the account to keep it. */
export function subscribeToChoices(listener: (choice: ColourChoice) => void): () => void {
  chosenListeners.add(listener);
  return () => chosenListeners.delete(listener);
}

/**
 * The person picks a colour: kept, drawn at once (no Apply), and said to the
 * account. The own hue goes with every name, so Custom opens on it again.
 */
export function chooseColour(name: SiteColour, hue: number | null, now: number = Date.now()) {
  const own = name === "custom" ? hue : (readColour()?.hue ?? null);
  const choice: ColourChoice = { name, hue: own, changedAt: now };
  keepColour(choice);
  void showColour(choice);
  chosenListeners.forEach((listener) => listener(choice));
}
