import { afterEach, describe, expect, it, vi } from "vitest";
import {
  localStorageStore,
  memoryStore,
  resetStorageTroubleForTests,
  sessionStorageStore,
  storageRefused,
} from "./storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  resetStorageTroubleForTests();
});

describe("the browser's stores", () => {
  it.each([
    ["localStorageStore", localStorageStore, () => window.localStorage],
    ["sessionStorageStore", sessionStorageStore, () => window.sessionStorage],
  ] as const)("%s reads, writes, lists and removes through its storage", (_, store, storage) => {
    store.write("k", "v");
    expect(storage().getItem("k")).toBe("v");
    expect(store.read("k")).toBe("v");
    expect(store.keys?.()).toContain("k");
    store.remove("k");
    expect(store.read("k")).toBeNull();
  });

  it("shrugs when storage throws: private mode, a full disk, a blocked site", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    for (const store of [localStorageStore, sessionStorageStore]) {
      expect(() => store.write("k", "v")).not.toThrow();
      expect(() => store.remove("k")).not.toThrow();
      expect(store.read("k")).toBeNull();
    }
  });

  // storage.ts promises the site works anyway and only forgets on reload.
  it("keeps what a blocked browser refused for the rest of the visit, and says it was refused", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(localStorageStore.write("tyl:board:b1", "v")).toBe(false);
    expect(storageRefused()).toBe(true);
    expect(localStorageStore.read("tyl:board:b1")).toBe("v");
    expect(localStorageStore.keys?.()).toEqual(["tyl:board:b1"]);
    localStorageStore.remove("tyl:board:b1");
    expect(localStorageStore.read("tyl:board:b1")).toBeNull();
  });

  it("lists nothing when even the storage object cannot be reached", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(localStorageStore.keys?.()).toEqual([]);
    expect(localStorageStore.read("k")).toBeNull();
  });
});

describe("memoryStore", () => {
  it("keeps what it is given until the page goes, each store on its own", () => {
    const one = memoryStore();
    const two = memoryStore();
    one.write("a", "1");
    one.write("b", "2");
    expect(one.read("a")).toBe("1");
    expect(two.read("a")).toBeNull();
    expect(one.keys?.()).toEqual(["a", "b"]);
    one.remove("a");
    expect(one.keys?.()).toEqual(["b"]);
  });
});
