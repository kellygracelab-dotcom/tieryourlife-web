import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { boot, drawFailure, type BootStore } from "./boot";
import { applyLocale, pickLocale, readLocale, type LocaleStore } from "./lib/locale";
import { availableLocales, currentLocale, loadStrings, strings } from "./strings";
import "./index.css";

const device: LocaleStore = {
  read: (key) => window.localStorage.getItem(key),
  write: (key, value) => window.localStorage.setItem(key, value),
  remove: (key) => window.localStorage.removeItem(key),
};

// For as long as the tab lives: a reload must remember that it was one.
const tab: BootStore = {
  read: (key) => window.sessionStorage.getItem(key),
  write: (key, value) => window.sessionStorage.setItem(key, value),
  remove: (key) => window.sessionStorage.removeItem(key),
};

const root = document.getElementById("root")!;
const reload = () => window.location.reload();

void boot({
  // The language first, the app after it. Several modules copy their texts when
  // they are imported (the names of the tiers a new list starts with, of the
  // reasons in a report), so the dictionary has to be in place before any of
  // them loads. Changing the language reloads the page for the same reason.
  load: async () => {
    await loadStrings(pickLocale(readLocale(device), navigator.languages, availableLocales()));
    // What actually loaded: a dictionary that would not come leaves the page in English.
    applyLocale(currentLocale());
    const { App } = await import("./App.tsx");
    return {
      mount: () =>
        createRoot(root).render(
          <StrictMode>
            <App />
          </StrictMode>,
        ),
    };
  },
  reload,
  store: tab,
  // In the person's language if the dictionary got here, in English if it did not.
  showFailure: () => drawFailure(root, strings.boot, reload),
});
