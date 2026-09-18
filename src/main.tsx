import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyLocale, pickLocale, readLocale, type LocaleStore } from "./lib/locale";
import { availableLocales, currentLocale, loadStrings } from "./strings";
import "./index.css";

const device: LocaleStore = {
  read: (key) => window.localStorage.getItem(key),
  write: (key, value) => window.localStorage.setItem(key, value),
  remove: (key) => window.localStorage.removeItem(key),
};

// The language first, the app after it. Several modules copy their texts when
// they are imported (the names of the tiers a new list starts with, of the
// reasons in a report), so the dictionary has to be in place before any of
// them loads. Changing the language reloads the page for the same reason.
await loadStrings(pickLocale(readLocale(device), navigator.languages, availableLocales()));
// What actually loaded: a dictionary that would not come leaves the page in English.
applyLocale(currentLocale());

const { App } = await import("./App.tsx");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
