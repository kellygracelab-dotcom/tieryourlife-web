import { describe, expect, it } from "vitest";
import { memoryStore } from "../../lib/storage";
import { deviceNameOf } from "./deviceName";
import { keepBackUp, readBackUp, syncKey, syncRecords } from "./syncRecords";

describe("the sync records", () => {
  it("keep one agreement per board, per account, and forget on demand", () => {
    const store = memoryStore();
    const mine = syncRecords(store, "me");
    const theirs = syncRecords(store, "them");
    expect(mine.all()).toEqual([]);
    mine.remember({ uid: "a", revision: 1, fingerprint: "x" });
    mine.remember({ uid: "b", revision: 2, fingerprint: "y" });
    mine.remember({ uid: "a", revision: 3, fingerprint: "z" });
    expect(mine.all()).toEqual([
      { uid: "a", revision: 3, fingerprint: "z" },
      { uid: "b", revision: 2, fingerprint: "y" },
    ]);
    expect(theirs.all()).toEqual([]);
    mine.forget("a");
    expect(mine.all().map((record) => record.uid)).toEqual(["b"]);
    expect(mine.lastSyncedAt()).toBeNull();
    mine.markSynced(123);
    expect(mine.lastSyncedAt()).toBe(123);
    expect(mine.merged()).toBe(false);
    mine.markMerged();
    expect(mine.merged()).toBe(true);
    mine.clear();
    expect(mine.all()).toEqual([]);
    expect(store.read(syncKey("me"))).toBeNull();
  });

  it("shrug off what does not parse", () => {
    const store = memoryStore();
    store.write(syncKey("me"), "{nope");
    expect(syncRecords(store, "me").all()).toEqual([]);
    store.write(syncKey("me"), JSON.stringify({ records: { a: { revision: "1" } } }));
    expect(syncRecords(store, "me").all()).toEqual([]);
  });

  it("back up unless switched off", () => {
    const store = memoryStore();
    expect(readBackUp(store)).toBe(true);
    keepBackUp(store, false);
    expect(readBackUp(store)).toBe(false);
    keepBackUp(store, true);
    expect(readBackUp(store)).toBe(true);
  });
});

describe("the device's name", () => {
  it("is the browser on the system when both are known, and nothing when neither is", () => {
    expect(
      deviceNameOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
    expect(
      deviceNameOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");
    expect(
      deviceNameOf("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"),
    ).toBe("Firefox on Linux");
    expect(
      deviceNameOf(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0",
      ),
    ).toBe("Edge on Windows");
    expect(deviceNameOf("curl/8.0")).toBeNull();
  });
});
