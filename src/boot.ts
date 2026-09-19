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

export interface BootStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface BootDeps {
  /** Fetches everything the first screen needs and hands back the way to draw it. */
  load: () => Promise<{ mount: () => void }>;
  reload: () => void;
  /** Lives as long as the tab: the reload must remember it has been tried. */
  store: BootStore;
  showFailure: () => void;
}

export type BootOutcome = "started" | "reloading" | "failed";

// A store that refuses (a private window) only means the reload is not
// remembered, and then there must be no reload at all, or it would never end.
const alreadyTried = (store: BootStore): boolean | null => {
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

/** Plain DOM, no framework: whatever failed to load may be the framework's own part. */
export function drawFailure(root: HTMLElement, words: FailureWords, reload: () => void): void {
  const section = document.createElement("section");
  section.className = "boot-failed";
  section.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = words.title;
  const body = document.createElement("p");
  body.textContent = words.body;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--filled";
  button.textContent = words.reload;
  button.addEventListener("click", reload);
  section.append(title, body, button);
  root.replaceChildren(section);
}
