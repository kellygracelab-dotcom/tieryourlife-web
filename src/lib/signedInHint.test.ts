import { describe, expect, it } from "vitest";
import { noteSignedIn, wasSignedIn } from "./signedInHint";
import { memoryStore } from "./storage";

describe("the signed-in note", () => {
  it("says a device was signed in until somebody else is seen there", () => {
    const store = memoryStore();
    expect(wasSignedIn(store)).toBe(false);
    noteSignedIn({ kind: "signedIn", uid: "u1", displayName: null, photoUrl: null }, store);
    expect(wasSignedIn(store)).toBe(true);
    noteSignedIn({ kind: "guest", uid: "g" }, store);
    expect(wasSignedIn(store)).toBe(false);
  });
});
