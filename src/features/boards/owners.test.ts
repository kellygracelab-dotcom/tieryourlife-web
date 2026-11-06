import { describe, expect, it, vi } from "vitest";
import { memoryStore } from "../../lib/storage";
import { newBoard } from "./model";
import { boardOwners } from "./owners";
import { boardKey } from "./repository";
import { backUpKey, BACKUP_KEY, syncKey, syncRecords } from "./syncRecords";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const board = (uid: string, title = uid) => newBoard(uid, title, 1, uids());
const titles = (boards: readonly { title: string }[]) => boards.map((b) => b.title).sort();

/** A browser where the guest has been, and owners settled. */
function settled() {
  const store = memoryStore();
  const owners = boardOwners(store);
  owners.arrived({ owner: null, guestUid: "guest" });
  return { store, owners };
}

describe("boardOwners", () => {
  it("hides an account's boards once it signs out, and shows them again when it signs back in", () => {
    const { owners } = settled();
    owners.arrived({ owner: "a", guestUid: null });
    owners.boards.save(board("exes", "Exes, ranked"));
    owners.arrived({ owner: null, guestUid: "guest2" });
    expect(owners.boards.all()).toEqual([]);
    expect(owners.boards.get("exes")).toBeNull();
    owners.arrived({ owner: "a", guestUid: null });
    expect(titles(owners.boards.all())).toEqual(["Exes, ranked"]);
  });

  it("never shows one account's boards to another, and asks nothing of it when there is nothing of nobody's", () => {
    const { owners } = settled();
    owners.arrived({ owner: "a", guestUid: null });
    owners.boards.save(board("exes", "Exes, ranked"));
    owners.arrived({ owner: null, guestUid: "guest2" });
    owners.arrived({ owner: "b", guestUid: null });
    expect(owners.boards.all()).toEqual([]);
    expect(owners.question()).toBeNull();
  });

  it("moves a guest's boards into the account the guest became, trash and all, unasked", () => {
    const { owners } = settled();
    owners.boards.save(board("films", "Films"));
    owners.boards.save({ ...board("old", "Old"), deletedAt: 5 });
    owners.arrived({ owner: "guest", guestUid: null });
    expect(owners.question()).toBeNull();
    expect(titles(owners.boards.all())).toEqual(["Films", "Old"]);
    expect(owners.of(null).all()).toEqual([]);
  });

  it("asks a new account that a later guest became, when the boards are an earlier guest's", () => {
    const { owners } = settled();
    owners.boards.save(board("made", "Guest made"));
    // Somebody signs into an account used before and keeps the boards here, then signs out.
    owners.arrived({ owner: "a", guestUid: null });
    owners.keepHere();
    owners.arrived({ owner: null, guestUid: "guest2" });
    // The next person turns that new guest into an account of their own.
    owners.arrived({ owner: "guest2", guestUid: null });
    expect(owners.question()).toEqual({ owner: "guest2", boards: 1 });
    expect(owners.boards.all()).toEqual([]);
    expect(titles(owners.of(null).all())).toEqual(["Guest made"]);
  });

  it("still moves a guest's own boards unasked once the earlier guest's are gone", () => {
    const { owners } = settled();
    owners.boards.save(board("made", "Guest made"));
    owners.arrived({ owner: "a", guestUid: null });
    owners.moveIn("a");
    owners.arrived({ owner: null, guestUid: "guest2" });
    owners.boards.save(board("mine", "Mine"));
    owners.arrived({ owner: "guest2", guestUid: null });
    expect(owners.question()).toBeNull();
    expect(titles(owners.boards.all())).toEqual(["Mine"]);
  });

  it("asks after a sign-in into an account used before, only for the boards in use", () => {
    const { owners } = settled();
    owners.boards.save(board("films", "Films"));
    owners.boards.save({ ...board("old", "Old"), deletedAt: 5 });
    owners.arrived({ owner: "a", guestUid: null });
    expect(owners.question()).toEqual({ owner: "a", boards: 1 });
    expect(owners.boards.all()).toEqual([]);

    owners.moveIn("a", (title) => (title === "Films" ? "Films (from this device)" : null));
    expect(owners.question()).toBeNull();
    expect(titles(owners.boards.all())).toEqual(["Films (from this device)", "Old"]);
  });

  it("keeps the boards made without an account here on request, shown again once signed out", () => {
    const { owners } = settled();
    owners.boards.save(board("films", "Films"));
    owners.arrived({ owner: "a", guestUid: null });
    owners.keepHere();
    expect(owners.question()).toBeNull();
    expect(owners.boards.all()).toEqual([]);
    owners.arrived({ owner: null, guestUid: "guest2" });
    expect(titles(owners.boards.all())).toEqual(["Films"]);
  });

  it("asks only on the sign-in itself: a page that opens signed in, or a second tab, is not asked", () => {
    const store = memoryStore();
    const first = boardOwners(store);
    first.arrived({ owner: null, guestUid: "guest" });
    first.boards.save(board("films"));
    first.arrived({ owner: "a", guestUid: null });
    expect(first.question()).not.toBeNull();
    // Another tab, or the next visit, hears of the same account afterwards.
    const second = boardOwners(store);
    second.arrived({ owner: "a", guestUid: null });
    expect(second.question()).toBeNull();
  });

  it("tells whoever listens when the owner changes", () => {
    const { owners } = settled();
    const listener = vi.fn();
    const stop = owners.boards.subscribe(listener);
    owners.arrived({ owner: "a", guestUid: null });
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it("keeps the boards of one owner apart from another's with the same uid", () => {
    const { owners } = settled();
    owners.boards.save(board("same", "Guest's"));
    owners.of("a").save(board("same", "Account's"));
    expect(owners.of(null).get("same")?.title).toBe("Guest's");
    expect(owners.of("a").get("same")?.title).toBe("Account's");
  });

  it("forgets a deleted account's boards, records and switch", () => {
    const { store, owners } = settled();
    owners.of("a").save(board("exes"));
    syncRecords(store, "a").remember({ uid: "exes", revision: 1, fingerprint: "f" });
    store.write(backUpKey("a"), "off");
    owners.forget("a");
    expect(owners.of("a").all()).toEqual([]);
    expect(store.read(syncKey("a"))).toBeNull();
    expect(store.read(backUpKey("a"))).toBeNull();
  });

  describe("boards from before owners", () => {
    const legacy = () => {
      const store = memoryStore();
      for (const uid of ["agreedA", "agreedBoth", "never"]) {
        store.write(boardKey(uid), JSON.stringify(board(uid)));
      }
      syncRecords(store, "a").remember({ uid: "agreedA", revision: 1, fingerprint: "f" });
      syncRecords(store, "a").remember({ uid: "agreedBoth", revision: 1, fingerprint: "f" });
      syncRecords(store, "b").remember({ uid: "agreedBoth", revision: 1, fingerprint: "f" });
      return store;
    };

    it("shows none until whoever is here is known", () => {
      const owners = boardOwners(legacy());
      expect(owners.boards.all()).toEqual([]);
    });

    it("go to the account that agreed on them, to the one signed in among several, and to whoever is here otherwise", () => {
      const store = legacy();
      const owners = boardOwners(store);
      owners.arrived({ owner: "b", guestUid: null });
      expect(titles(owners.of("a").all())).toEqual(["agreedA"]);
      expect(titles(owners.of("b").all())).toEqual(["agreedBoth", "never"]);
      expect(owners.of(null).all()).toEqual([]);
      // The account that lost a board forgets agreeing on it, so it comes down there as a copy.
      expect(
        syncRecords(store, "a")
          .all()
          .map((record) => record.uid),
      ).toEqual(["agreedA"]);
      expect(owners.question()).toBeNull();
    });

    it("stay nobody's when nobody is signed in and no account agreed on them", () => {
      const owners = boardOwners(legacy());
      owners.arrived({ owner: null, guestUid: "guest" });
      expect(titles(owners.boards.all())).toEqual(["never"]);
      expect(titles(owners.of("a").all())).toEqual(["agreedA", "agreedBoth"]);
    });

    it("give the browser's back-up switch to the account signed in", () => {
      const store = legacy();
      store.write(BACKUP_KEY, "off");
      boardOwners(store).arrived({ owner: "a", guestUid: null });
      expect(store.read(backUpKey("a"))).toBe("off");
      expect(store.read(BACKUP_KEY)).toBeNull();
    });
  });
});
