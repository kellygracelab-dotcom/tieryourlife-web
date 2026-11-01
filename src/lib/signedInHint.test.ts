import { describe, expect, it } from "vitest";
import { lastSeen, noteSignedIn, SIGNED_IN_KEY, wasSignedIn } from "./signedInHint";
import { memoryStore } from "./storage";

describe("the signed-in note", () => {
  it("keeps who was signed in, their name and face, until somebody else is seen there", () => {
    const store = memoryStore();
    expect(wasSignedIn(store)).toBe(false);
    expect(lastSeen(store)).toBeNull();
    noteSignedIn(
      { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: "https://f" },
      store,
    );
    expect(wasSignedIn(store)).toBe(true);
    expect(lastSeen(store)).toEqual({ displayName: "Danylo", photoUrl: "https://f" });
    noteSignedIn({ kind: "guest", uid: "g" }, store);
    expect(wasSignedIn(store)).toBe(false);
  });

  it("takes an older or broken note for signed in, with nothing more", () => {
    const store = memoryStore();
    for (const kept of ["1", "{broken", JSON.stringify({ displayName: 3 })]) {
      store.write(SIGNED_IN_KEY, kept);
      expect(lastSeen(store)).toEqual({ displayName: null, photoUrl: null });
    }
  });
});
