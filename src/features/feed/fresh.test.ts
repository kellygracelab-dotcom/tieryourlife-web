import { describe, expect, it } from "vitest";
import type { ListSummary } from "../../api/types";
import { FRESH_ON_TOP, freshOnTop, withFreshOnTop } from "./fresh";
import type { FeedState } from "./useFeed";

const list = (id: string, authorUid = `u-${id}`): ListSummary => ({
  id,
  title: id,
  authorUid,
  authorName: authorUid,
  authorPhotoUrl: null,
  category: "games",
  itemCount: 10,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

const ready = (ids: string[], next: string | null): FeedState => ({
  status: "ready",
  lists: ids.map((id) => list(id)),
  next,
  more: "idle",
  followingNobody: false,
});

const NOBODY = { lists: [], authors: [] };

describe("fresh lists first in Popular", () => {
  it("stand first, never again below, and leave Popular's cursor as the server gave it", () => {
    const shown = withFreshOnTop(ready(["p1", "f2", "p3"], "p3"), [list("f1"), list("f2")]);
    expect(shown.status === "ready" && shown.lists.map((one) => one.id)).toEqual([
      "f1",
      "f2",
      "p1",
      "p3",
    ]);
    expect(shown.status === "ready" && shown.next).toBe("p3");
  });

  it("leave Popular alone while it loads, fails, or with none", () => {
    const loading: FeedState = { status: "loading" };
    expect(withFreshOnTop(loading, [list("f1")])).toBe(loading);
    const page = ready(["p1"], null);
    expect(withFreshOnTop(page, [])).toBe(page);
  });

  it("are at most four, in the server's order, from one on", () => {
    const fresh = ["a", "b", "c", "d", "e"].map((id) => list(id));
    expect(freshOnTop(fresh, NOBODY, []).map((one) => one.id)).toEqual(["a", "b", "c", "d"]);
    expect(FRESH_ON_TOP).toBe(4);
    expect(freshOnTop([list("a")], NOBODY, []).map((one) => one.id)).toEqual(["a"]);
  });

  it("leave out what a reader hid before, keeping one hidden just now for its Undo", () => {
    const fresh = [list("a"), list("b", "gone"), list("c"), list("d"), list("e")];
    const hidden = { lists: [{ id: "a", title: "a" }], authors: [{ uid: "gone", name: "gone" }] };
    expect(freshOnTop(fresh, hidden, []).map((one) => one.id)).toEqual(["c", "d", "e"]);
    expect(freshOnTop(fresh, hidden, ["a"]).map((one) => one.id)).toEqual(["a", "c", "d", "e"]);
  });
});
