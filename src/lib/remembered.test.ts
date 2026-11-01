import { describe, expect, it } from "vitest";
import { remembered } from "./remembered";
import { memoryStore } from "./storage";

describe("remembered", () => {
  it("gives back what it kept, and only the newest few", () => {
    const store = memoryStore();
    const kept = remembered<{ n: number }>(store, "t", 2);
    expect(kept.recall("a")).toBeNull();
    kept.keep("a", { n: 1 });
    kept.keep("b", { n: 2 });
    kept.keep("a", { n: 3 });
    kept.keep("c", { n: 4 });
    expect(kept.recall("a")).toEqual({ n: 3 });
    expect(kept.recall("c")).toEqual({ n: 4 });
    // The oldest one goes, and nothing of it stays behind.
    expect(kept.recall("b")).toBeNull();
    expect(store.keys?.().sort()).toEqual(["t:a", "t:c", "t:keys"]);
  });

  it("takes anything unreadable for nothing", () => {
    const store = memoryStore();
    store.write("t:a", "{not json");
    store.write("t:keys", "also not json");
    const kept = remembered<number>(store, "t", 2);
    expect(kept.recall("a")).toBeNull();
    kept.keep("b", 1);
    expect(kept.recall("b")).toBe(1);
    store.write("t:keys", JSON.stringify({ not: "a list" }));
    kept.keep("c", 2);
    expect(JSON.parse(store.read("t:keys") ?? "")).toEqual(["c"]);
  });
});
