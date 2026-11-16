import type { KeyValueStore } from "./lib/storage";
/**
 * Starting the site, for the day a part of it does not arrive.
 *
 * The app is imported after the dictionary, in pieces that are fetched one by
 * one. A phone that changes from Wi-Fi to the mobile network in that second, a
 * deploy that renames the files between the page and its scripts, a train in a
 * tunnel: the import is rejected, nothing is mounted, and the person looks at a
 * blank page that says nothing. So: one quiet reload, which cures most of
 * these, and if the second try fails too, words and a button instead of white.
 */

export const RETRY_KEY = "tyl:boot-retry";

/**
 * The mark index.html's guard puts on the address when it reloads past the
 * caches for a script that never came. Its work is done once the site runs.
 */
export const FRESH_PARAM = "tyl-fresh";

/** The address without the guard's mark, or null when it carries none. */
export function withoutFreshMark(href: string): string | null {
  const address = new URL(href);
  if (!address.searchParams.has(FRESH_PARAM)) return null;
  address.searchParams.delete(FRESH_PARAM);
  return address.href;
}

export interface BootDeps {
  /** Fetches everything the first screen needs and hands back the way to draw it. */
  load: () => Promise<{ mount: () => void }>;
  reload: () => void;
  /** Lives as long as the tab: the reload must remember it has been tried. */
  store: KeyValueStore;
  showFailure: () => void;
}

export type BootOutcome = "started" | "reloading" | "failed";

// A store that refuses (a private window) only means the reload is not
// remembered, and then there must be no reload at all, or it would never end.
const alreadyTried = (store: KeyValueStore): boolean | null => {
  try {
    return store.read(RETRY_KEY) !== null;
  } catch {
    return null;
  }
};

export async function boot(deps: BootDeps): Promise<BootOutcome> {
  try {
    const app = await deps.load();
    app.mount();
    try {
      deps.store.remove(RETRY_KEY);
    } catch {
      // Nothing was kept, so nothing to forget.
    }
    return "started";
  } catch {
    if (alreadyTried(deps.store) === false) {
      try {
        deps.store.write(RETRY_KEY, "1");
        deps.reload();
        return "reloading";
      } catch {
        // Could not note the try: fall through to the words.
      }
    }
    try {
      deps.store.remove(RETRY_KEY);
    } catch {
      // As above.
    }
    deps.showFailure();
    return "failed";
  }
}

export interface FailureWords {
  title: string;
  body: string;
  reload: string;
}

const SVG = "http://www.w3.org/2000/svg";

/** An element with its class, and the children it holds. */
const made = (tag: string, className: string, ...children: (Node | string)[]): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.append(...children);
  return element;
};

/** The refresh arrow, drawn: the icons' font may be what did not arrive. */
function refreshIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M20 12a8 8 0 1 1-2.3-5.7M20 4.5v4.5h-4.5");
  icon.append(path);
  return icon;
}

/**
 * Plain DOM, no framework: whatever failed to load may be the framework's own
 * part. It wears the error page's look (src/app/RouteError.css, which main.tsx
 * brings with the first stylesheet): the S row with a card fallen out of it,
 * its swing all keyframes.
 */
export function drawFailure(root: HTMLElement, words: FailureWords, reload: () => void): void {
  const fallen = made(
    "div",
    "reload-notice__fallen",
    made(
      "div",
      "reload-notice__row",
      made("span", "reload-notice__tier", "S"),
      made(
        "span",
        "reload-notice__cards",
        made("span", "reload-notice__card"),
        made("span", "reload-notice__card"),
      ),
    ),
    made("span", "reload-notice__loose", "!"),
  );
  fallen.setAttribute("aria-hidden", "true");
  const button = made("button", "reload-notice__reload", refreshIcon(), words.reload);
  button.setAttribute("type", "button");
  button.addEventListener("click", reload);
  const section = made(
    "section",
    "reload-notice",
    fallen,
    made("h1", "reload-notice__title", words.title),
    made("p", "reload-notice__text", words.body),
    made("div", "reload-notice__actions", button),
  );
  section.setAttribute("role", "alert");
  root.replaceChildren(section);
}
