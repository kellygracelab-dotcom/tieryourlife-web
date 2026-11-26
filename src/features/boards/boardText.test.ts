import { describe, expect, it } from "vitest";
import { labelOf } from "./boardText";
import { newBoard } from "./model";

const fresh = () => {
  let n = 0;
  return newBoard("b", "Films", 1, () => `u${n++}`);
};

describe("a list's label in Your lists (artboard 42)", () => {
  it("says Public for one out in Community, Saved for somebody else's, nothing for one's own", () => {
    expect(labelOf(fresh())).toBeNull();
    expect(labelOf({ ...fresh(), publishedId: "L1", authorName: "danylo" })).toBe("Public");
    // A ranking sent to a list is out too.
    expect(labelOf({ ...fresh(), rankingOf: "L2" })).toBe("Public");
    expect(labelOf({ ...fresh(), authorName: "someone" })).toBe("Saved");
    expect(labelOf({ ...fresh(), takenFrom: "L3" })).toBe("Saved");
  });

  // A send in the background says so on its row (publish-update-speed BRIEF, 2 and 7).
  it("says Public · updating while an Update is on its way, and Publishing… for a first Publish", () => {
    const out = { ...fresh(), publishedId: "L1", authorName: "danylo" };
    expect(labelOf(out, "updating")).toBe("Public · updating");
    expect(labelOf(fresh(), "publishing")).toBe("Publishing…");
    expect(labelOf(out, null)).toBe("Public");
  });
});
