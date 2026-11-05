import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { localStorageStore, memoryStore } from "../../lib/storage";
import { HIDDEN_KEY, readHidden, writeHidden } from "./hidden";
import { useHidden, useHiddenStoreForTests } from "./useHidden";

const olena = { uid: "authorA1", name: "Olena" };
const list = { id: "R9", title: "Taras list" };

describe("useHidden across tabs", () => {
  afterEach(() => useHiddenStoreForTests(localStorageStore));

  it("adds to what another tab hid instead of writing its own old copy over it", () => {
    const store = memoryStore();
    useHiddenStoreForTests(store);
    const { result } = renderHook(() => useHidden());
    // Another tab hides Olena after this one read the store.
    writeHidden(store, { lists: [], authors: [olena] });
    act(() => result.current.hideList(list));
    expect(readHidden(store)).toEqual({ lists: [list], authors: [olena] });
    expect(result.current.hidden.authors).toEqual([olena]);
  });

  it("shows what another tab hid as soon as it is stored", () => {
    useHiddenStoreForTests(localStorageStore);
    const { result } = renderHook(() => useHidden());
    act(() => {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify({ lists: [], authors: [olena] }));
      window.dispatchEvent(new StorageEvent("storage", { key: HIDDEN_KEY }));
    });
    expect(result.current.hidden.authors).toEqual([olena]);
    act(() => result.current.showAuthor(olena.uid));
    expect(window.localStorage.getItem(HIDDEN_KEY)).toBeNull();
  });
});
