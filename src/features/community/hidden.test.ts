import { describe, expect, it } from "vitest";
import { memoryStore } from "../board/draft";
import {
  HIDDEN_KEY,
  isAuthorHidden,
  isListHidden,
  isOutOfSight,
  NOTHING_HIDDEN,
  readHidden,
  withAuthor,
  withList,
  withoutAuthor,
  withoutList,
  writeHidden,
} from "./hidden";

describe("hidden", () => {
  it("keeps lists and authors with their names, once each, and forgets them again", () => {
    let hidden = withList(NOTHING_HIDDEN, { id: "l1", title: "One" });
    hidden = withList(hidden, { id: "l1", title: "One again" });
    hidden = withAuthor(hidden, { uid: "u1", name: "Dan" });
    hidden = withAuthor(hidden, { uid: "u1", name: "Dan" });
    expect(hidden).toEqual({
      lists: [{ id: "l1", title: "One" }],
      authors: [{ uid: "u1", name: "Dan" }],
    });
    expect(isListHidden(hidden, "l1")).toBe(true);
    expect(isAuthorHidden(hidden, "u1")).toBe(true);
    expect(isOutOfSight(hidden, { id: "l2", authorUid: "u1" })).toBe(true);
    expect(isOutOfSight(hidden, { id: "l2", authorUid: "u2" })).toBe(false);

    hidden = withoutAuthor(withoutList(hidden, "l1"), "u1");
    expect(hidden).toEqual(NOTHING_HIDDEN);
  });

  it("survives a reload, drops what it cannot read, and leaves no key when empty", () => {
    const store = memoryStore();
    const hidden = withAuthor(withList(NOTHING_HIDDEN, { id: "l1", title: "One" }), {
      uid: "u1",
      name: "Dan",
    });
    writeHidden(store, hidden);
    expect(readHidden(store)).toEqual(hidden);

    store.write(
      HIDDEN_KEY,
      JSON.stringify({ lists: [{ id: 5 }, { id: "ok", title: "T" }], authors: "no" }),
    );
    expect(readHidden(store)).toEqual({ lists: [{ id: "ok", title: "T" }], authors: [] });
    store.write(HIDDEN_KEY, "{not json");
    expect(readHidden(store)).toEqual(NOTHING_HIDDEN);

    writeHidden(store, NOTHING_HIDDEN);
    expect(store.read(HIDDEN_KEY)).toBeNull();
    expect(readHidden(store)).toEqual(NOTHING_HIDDEN);
  });
});
