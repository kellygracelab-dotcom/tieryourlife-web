import { afterEach, describe, expect, it } from "vitest";
import { memoryStore } from "../../lib/storage";
import {
  INTENT_LASTS_MS,
  hasIntent,
  intentStoreForTests,
  keepIntent,
  takeIntent,
} from "./afterSignIn";

describe("afterSignIn", () => {
  afterEach(() => intentStoreForTests(memoryStore()));

  it("does what was asked once, on the way back from the sign-in", () => {
    intentStoreForTests(memoryStore());
    keepIntent({ kind: "follow", uid: "u1" }, 1_000);
    expect(hasIntent({ kind: "follow", uid: "u2" }, 2_000)).toBe(false);
    expect(takeIntent({ kind: "follow", uid: "u1" }, 2_000)).toBe(true);
    expect(takeIntent({ kind: "follow", uid: "u1" }, 2_000)).toBe(false);
  });

  it("lets an old intent go, so a later sign-in follows nobody on its behalf", () => {
    intentStoreForTests(memoryStore());
    keepIntent({ kind: "follow", uid: "u1" }, 1_000);
    expect(takeIntent({ kind: "follow", uid: "u1" }, 1_000 + INTENT_LASTS_MS + 1)).toBe(false);
    expect(takeIntent({ kind: "follow", uid: "u1" }, 1_001)).toBe(false);
  });
});
