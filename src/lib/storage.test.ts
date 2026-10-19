import { afterEach, describe, expect, it, vi } from "vitest";
import { localStorageStore, memoryStore, sessionStorageStore } from "./storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
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
      expect(store.read("k")).toBeNull();
      expect(() => store.remove("k")).not.toThrow();
    }
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
