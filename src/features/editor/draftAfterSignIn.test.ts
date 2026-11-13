import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryStore, sessionStorageStore, type KeyValueStore } from "../../lib/storage";
import {
  DRAFT_LASTS_MS,
  draftForSignIn,
  draftStoreForTests,
  forgetDraftForSignIn,
  keepDraftForSignIn,
  takeDraftForSignIn,
} from "./draftAfterSignIn";

let store: KeyValueStore;
beforeEach(() => {
  store = memoryStore();
  draftStoreForTests(store);
});
afterEach(() => draftStoreForTests(sessionStorageStore));

const draft = {
  path: "/b/one",
  url: "https://img.test/a.jpg",
  name: "Dune",
  page: "https://site.test/dune",
};

describe("a guest's draft card while the sign-in goes away", () => {
  it("comes back on the board it was made on, once", () => {
    keepDraftForSignIn(draft, 1_000);
    expect(draftForSignIn("/b/other", 2_000)).toBeNull();
    expect(draftForSignIn("/b/one", 2_000)).toEqual(draft);
    expect(takeDraftForSignIn("/b/one", 2_000)).toEqual(draft);
    expect(takeDraftForSignIn("/b/one", 2_000)).toBeNull();
  });

  it("lasts ten minutes", () => {
    keepDraftForSignIn(draft, 1_000);
    expect(draftForSignIn("/b/one", 1_000 + DRAFT_LASTS_MS)).toEqual(draft);
    expect(draftForSignIn("/b/one", 1_001 + DRAFT_LASTS_MS)).toBeNull();
    // Gone for good once found stale.
    expect(draftForSignIn("/b/one", 1_000)).toBeNull();
  });

  it("is forgotten when asked, and nothing is made of what is not one", () => {
    keepDraftForSignIn(draft, 1_000);
    forgetDraftForSignIn();
    expect(draftForSignIn("/b/one", 1_000)).toBeNull();
    store.write("tyl:draftAfterSignIn", "{not json");
    expect(draftForSignIn("/b/one", 1_000)).toBeNull();
    store.write("tyl:draftAfterSignIn", JSON.stringify({ ...draft, at: "soon" }));
    expect(draftForSignIn("/b/one", 1_000)).toBeNull();
    store.write("tyl:draftAfterSignIn", JSON.stringify({ path: "/b/one", url: "", at: 1_000 }));
    expect(draftForSignIn("/b/one", 1_000)).toBeNull();
    store.write(
      "tyl:draftAfterSignIn",
      JSON.stringify({ path: "/b/one", url: "https://img.test/a.jpg", name: 5, at: 1_000 }),
    );
    expect(draftForSignIn("/b/one", 1_000)).toEqual({
      path: "/b/one",
      url: "https://img.test/a.jpg",
      name: "",
      page: "",
    });
  });
});
