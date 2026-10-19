import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { boot, drawFailure } from "./boot";
import { applyLocale, pickLocale, readLocale } from "./lib/locale";
import { localStorageStore, sessionStorageStore } from "./lib/storage";
import { availableLocales, currentLocale, loadStrings, strings } from "./strings";
// Roboto from the site itself, every script it has, each fetched only when a page needs it.
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
const reload = () => window.location.reload();

void boot({
  // The language first, the app after it. Several modules copy their texts when
  // they are imported (the names of the tiers a new list starts with, of the
  // reasons in a report), so the dictionary has to be in place before any of
  // them loads. Changing the language reloads the page for the same reason.
  load: async () => {
    await loadStrings(
      pickLocale(readLocale(localStorageStore), navigator.languages, availableLocales()),
    );
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
  // For as long as the tab lives: a reload must remember that it was one.
  store: sessionStorageStore,
  // In the person's language if the dictionary got here, in English if it did not.
  showFailure: () => drawFailure(root, strings.boot, reload),
});
