import { describe, expect, it } from "vitest";
import {
  applyLocale,
  directionOf,
  keepLocale,
  LOCALE_KEY,
  LOCALE_NAMES,
  LOCALES,
  pickLocale,
  readLocale,
  type Locale,
  type LocaleStore,
} from "./locale";

function memoryStore(): LocaleStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

const refusing: LocaleStore = {
  read: () => {
    throw new Error("no storage");
  },
  write: () => {
    throw new Error("no storage");
  },
  remove: () => undefined,
};

describe("locale", () => {
  it("speaks the phone app's eleven languages and names each in itself", () => {
    expect(LOCALES).toHaveLength(11);
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
    expect(LOCALE_NAMES.uk).toBe("Українська");
    expect(LOCALE_NAMES.ar).toBe("العربية");
  });

  it("opens in the language chosen here, as long as it has a dictionary", () => {
    const all: Locale[] = ["en", "uk", "ru"];
    expect(pickLocale("ru", ["en-US"], all)).toBe("ru");
    // Chosen once, but its dictionary is gone: the browser decides again.
    expect(pickLocale("ja", ["uk-UA"], all)).toBe("uk");
  });

  it("otherwise takes the first of the browser's languages it can speak, by tag and then by language", () => {
    const all: Locale[] = ["en", "uk", "pt-BR", "ar"];
    expect(pickLocale(null, ["pt-BR", "en"], all)).toBe("pt-BR");
    expect(pickLocale(null, ["pt-PT"], all)).toBe("pt-BR");
    expect(pickLocale(null, ["UK-ua", "ru"], all)).toBe("uk");
    expect(pickLocale(null, ["ko-KR", "ar-EG"], all)).toBe("ar");
    expect(pickLocale(null, ["ko-KR"], all)).toBe("en");
    expect(pickLocale(null, [], all)).toBe("en");
    // A language the site will speak one day, without a dictionary today.
    expect(pickLocale(null, ["de-DE"], ["en"])).toBe("en");
  });

  it("keeps the choice on the device and shrugs at what it cannot read", () => {
    const store = memoryStore();
    expect(readLocale(store)).toBeNull();
    keepLocale(store, "pl");
    expect(store.data.get(LOCALE_KEY)).toBe("pl");
    expect(readLocale(store)).toBe("pl");
    store.data.set(LOCALE_KEY, "klingon");
    expect(readLocale(store)).toBeNull();

    expect(readLocale(refusing)).toBeNull();
    expect(() => keepLocale(refusing, "de")).not.toThrow();
  });

  it("puts the language and its direction on the page, right to left for Arabic alone", () => {
    const root = document.createElement("html");
    applyLocale("ar", root);
    expect(root.lang).toBe("ar");
    expect(root.dir).toBe("rtl");
    applyLocale("ja", root);
    expect(root.lang).toBe("ja");
    expect(root.dir).toBe("ltr");
    expect(LOCALES.filter((locale) => directionOf(locale) === "rtl")).toEqual(["ar"]);
  });
});
