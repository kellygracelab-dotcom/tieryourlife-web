import { describe, expect, it, vi } from "vitest";
import type { KeepBoardRequest, KeptBoard, KeptBoardEntry } from "../../api/boards";
import { ApiFailure } from "../../api/errors";
import { memoryStore } from "../../lib/storage";
import {
  addToPool,
  isBehind,
  liveItems,
  newBoard,
  rename,
  setFavourite,
  type Board,
} from "./model";
import { boardsRepository } from "./repository";
import { fingerprintOf } from "./fingerprint";
import { syncBoards, type BoardsApi, type PublishedEntry } from "./sync";
import { syncRecords } from "./syncRecords";

const uids = (prefix = "u") => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** A board with two cards in the pool. */
const films = (uid = "films", title = "Films"): Board => {
  const next = uids(`${uid}-`);
  return addToPool(
    newBoard(uid, title, 100, next),
    ["Dune", "Heat"].map((name) => ({ title: name, imageUrl: null })),
    100,
    next,
  );
};

/** A published list by its id alone names no board, as one published before the server kept it. */
const entryOfList = (list: string | PublishedEntry): PublishedEntry =>
  typeof list === "string" ? { id: list, boardUid: null, updatedAt: 0 } : list;

/** The account, in memory: what it keeps, what it was asked, and a way to make it refuse. */
function fakeAccount(published: (string | PublishedEntry)[] | null = []) {
  const kept = new Map<string, KeptBoard>();
  const keeps: { uid: string; request: KeepBoardRequest }[] = [];
  const forgotten: string[] = [];
  let conflictWith: KeptBoard | null = null;
  const entryOf = (board: KeptBoard): KeptBoardEntry => ({
    uid: board.uid,
    revision: board.revision,
    updatedAt: board.updatedAt,
    deviceName: board.deviceName,
    deleted: board.deleted,
    fingerprint: board.fingerprint,
    title: board.title,
    itemCount: board.items.length,
  });
  const api: BoardsApi = {
    index: () => Promise.resolve({ boards: [...kept.values()].map(entryOf), next: null }),
    board: (uid) => {
      const board = kept.get(uid);
      return board === undefined
        ? Promise.reject(new ApiFailure({ kind: "notFound" }))
        : Promise.resolve(board);
    },
    keep: (uid, request) => {
      keeps.push({ uid, request });
      if (conflictWith !== null) {
        const theirs = conflictWith;
        conflictWith = null;
        return Promise.reject(new ApiFailure({ kind: "conflict", board: theirs }));
      }
      const revision = (kept.get(uid)?.revision ?? 0) + 1;
      kept.set(uid, {
        ...request,
        uid,
        revision,
        updatedAt: 500 + revision,
        deleted: false,
      });
      return Promise.resolve({ uid, revision });
    },
    forget: (uid) => {
      forgotten.push(uid);
      const was = kept.get(uid);
      if (was !== undefined) kept.set(uid, { ...was, deleted: true, revision: was.revision + 1 });
      return Promise.resolve();
    },
    published: () => Promise.resolve(published === null ? null : published.map(entryOfList)),
  };
  /** A board the account holds as if another device wrote it. */
  const holds = (board: Board, revision = 1, deviceName = "Pixel 7", fingerprint = "theirs") => {
    kept.set(board.uid, {
      ...board,
      revision,
      updatedAt: 900,
      deviceName,
      deleted: false,
      fingerprint,
    });
  };
  return {
    api,
    kept,
    keeps,
    forgotten,
    holds,
    refuseNextWith: (board: KeptBoard) => {
      conflictWith = board;
    },
  };
}

const setUp = (published: (string | PublishedEntry)[] | null = []) => {
  const store = memoryStore();
  const repository = boardsRepository(store);
  const records = syncRecords(store, "me");
  const account = fakeAccount(published);
  const run = (extra: Partial<Parameters<typeof syncBoards>[0]> = {}) =>
    syncBoards({
      repository,
      api: account.api,
      records,
      deviceName: "Chrome on Linux",
      now: () => 1000,
      nextUid: uids("new-"),
      ...extra,
    });
  return { repository, records, account, run };
};

describe("syncBoards", () => {
  it("sends a board the account has never seen, and writes down the agreement", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(account.keeps).toHaveLength(1);
    const { uid, request } = account.keeps[0]!;
    expect(uid).toBe("films");
    expect(request.basedOn).toBeNull();
    expect(request.deviceName).toBe("Chrome on Linux");
    expect(request.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(request.items.map((item) => item.title)).toEqual(["Dune", "Heat"]);
    expect(request.tiers.filter((tier) => tier.isPool)).toHaveLength(1);
    // Nothing of this device's travels.
    expect(request).not.toHaveProperty("editedAt");
    expect(request).not.toHaveProperty("favouritedAt");
    expect(request).not.toHaveProperty("topic");
    expect(request).not.toHaveProperty("takenFrom");
    expect(request).not.toHaveProperty("rankingOf");
    expect(records.all()).toEqual([
      { uid: "films", revision: 1, fingerprint: request.fingerprint },
    ]);
    expect(records.lastSyncedAt()).toBe(1000);

    // A second run with nothing changed sends nothing: the one step is writing
    // down that both sides still agree.
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(account.keeps).toHaveLength(1);
  });

  it("sends a picture's credit up and brings it down, and leaves it out where there is none", async () => {
    const { repository, account, run } = setUp();
    const board = films();
    repository.save({
      ...board,
      items: board.items.map((item) =>
        item.title === "Dune" ? { ...item, credit: "(c) Jane Doe (CC BY)" } : item,
      ),
    });
    await run();
    const [dune, heat] = account.keeps[0]!.request.items;
    expect(dune).toMatchObject({ title: "Dune", credit: "(c) Jane Doe (CC BY)" });
    expect(heat).not.toHaveProperty("credit");

    const there = setUp();
    const theirs = films("theirs");
    there.account.holds({
      ...theirs,
      items: theirs.items.map((item) =>
        item.title === "Dune" ? { ...item, credit: "(c) Jane Doe (CC BY)" } : item,
      ),
    });
    await there.run();
    expect(there.repository.get("theirs")!.items.map((item) => item.credit)).toEqual([
      "(c) Jane Doe (CC BY)",
      null,
    ]);
  });

  it("sends a board changed here over the revision it was working from", async () => {
    const { repository, account, run } = setUp();
    repository.save(films());
    await run();
    repository.save(rename(repository.get("films")!, "Films I like", 200));
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(account.keeps[1]).toMatchObject({
      uid: "films",
      request: { basedOn: 1, title: "Films I like" },
    });
  });

  it("takes the account's version when only the account moved on, and keeps the star and the topic", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    await run();
    const topic = { id: "t1", name: "Sci-fi" };
    // Where it was saved from, and the ranking it is out as, are this device's too.
    repository.save({
      ...setFavourite(repository.get("films")!, 7),
      topic,
      takenFrom: "src",
      rankingOf: "src",
    });
    // Another device renamed it: revision 2 on the account.
    const theirs = account.kept.get("films")!;
    account.kept.set("films", {
      ...theirs,
      revision: 2,
      title: "Their name",
      fingerprint: "other",
    });
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    const board = repository.get("films")!;
    expect(board.title).toBe("Their name");
    expect(board.favouritedAt).toBe(7);
    expect(board.topic).toEqual(topic);
    expect(board).toMatchObject({ takenFrom: "src", rankingOf: "src" });
    expect(records.all()[0]?.revision).toBe(2);
  });

  it("never writes down, nor later takes out of the account, a board the browser would not keep", async () => {
    const store = memoryStore();
    // A browser whose storage is full: the big board does not fit, the small record still does.
    const full = {
      ...store,
      write: (key: string, value: string) =>
        key.endsWith(":big") ? false : store.write(key, value),
    };
    const repository = boardsRepository(full);
    const records = syncRecords(store, "me");
    const account = fakeAccount();
    account.holds(films("big", "Everything I watched"));
    account.holds(films("small", "Snacks"));
    const run = () =>
      syncBoards({
        repository,
        api: account.api,
        records,
        deviceName: "Chrome on Linux",
        now: () => 1000,
        nextUid: uids("new-"),
      }).catch(() => null);
    await run();
    expect(records.all().map((record) => record.uid)).not.toContain("big");
    await run();
    expect(account.forgotten).toEqual([]);
    expect(account.kept.get("big")?.deleted).toBe(false);
  });

  describe("a browser that holds a refused board only for the visit", () => {
    /**
     * As the browser's own store does: a write that does not fit is held in
     * memory, read back for the visit, and gone after a reload.
     */
    const fullFor = (refused: (key: string) => boolean) => {
      const disk = memoryStore();
      const visit = () => {
        const held = new Map<string, string>();
        const store = {
          read: (key: string) => held.get(key) ?? disk.read(key),
          write: (key: string, value: string) => {
            if (refused(key)) {
              held.set(key, value);
              return false;
            }
            held.delete(key);
            return disk.write(key, value);
          },
          remove: (key: string) => {
            held.delete(key);
            disk.remove(key);
          },
          keys: () => [...new Set([...(disk.keys?.() ?? []), ...held.keys()])],
          heldOnly: (key: string) => held.has(key),
        };
        return { repository: boardsRepository(store), records: syncRecords(disk, "me") };
      };
      return { disk, visit };
    };

    const runOn = (
      on: {
        repository: ReturnType<typeof boardsRepository>;
        records: ReturnType<typeof syncRecords>;
      },
      api: BoardsApi,
    ) =>
      syncBoards({
        repository: on.repository,
        api,
        records: on.records,
        deviceName: "Chrome on Linux",
        now: () => 1000,
        nextUid: uids("new-"),
      }).catch(() => null);

    it("never agrees about a board from the account the browser would not keep, and the next visit leaves it in the account", async () => {
      const account = fakeAccount();
      // Sent by another device, with its real fingerprint.
      const first = setUp();
      first.repository.save(films("big", "Everything I watched"));
      await first.run({ api: account.api });

      const full = fullFor((key) => key.endsWith(":big"));
      const today = full.visit();
      await runOn(today, account.api);
      // Held for the visit, so the shelf shows it, and a second run finds it the same as the account's.
      expect(today.repository.get("big")).not.toBeNull();
      await runOn(today, account.api);
      expect(today.records.all().map((record) => record.uid)).not.toContain("big");

      await runOn(full.visit(), account.api);
      expect(account.forgotten).toEqual([]);
      expect(account.kept.get("big")?.deleted).toBe(false);
    });

    it("never agrees about an edit the browser would not keep, so the next visit takes the account's newer version", async () => {
      const account = fakeAccount();
      let refusing = false;
      const full = fullFor((key) => refusing && key.endsWith(":films"));
      const today = full.visit();
      today.repository.save(films());
      await runOn(today, account.api);
      expect(account.kept.get("films")?.revision).toBe(1);

      refusing = true;
      const edited = rename(today.repository.get("films")!, "Films I loved", 2000);
      expect(today.repository.save(edited)).toBe(false);
      await runOn(today, account.api);
      expect(account.kept.get("films")?.title).toBe("Films I loved");

      refusing = false;
      const tomorrow = full.visit();
      await runOn(tomorrow, account.api);
      // The older board left on the disk did not go up over the newer one.
      expect(account.kept.get("films")?.title).toBe("Films I loved");
      expect(tomorrow.repository.get("films")?.title).toBe("Films I loved");
    });
  });

  it("brings down a board this device has never had, with its pictures found by id", async () => {
    const { repository, account, run } = setUp();
    const theirs = films("theirs", "From the phone");
    const [dune] = liveItems(theirs);
    account.holds({
      ...theirs,
      items: theirs.items.map((item) =>
        item.uid === dune!.uid ? { ...item, pictureId: "pic-1", imageUrl: null } : item,
      ),
    });
    const resolvePicture = vi.fn((id: string) => Promise.resolve(`https://pictures/${id}`));
    expect(await run({ resolvePicture })).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    const board = repository.get("theirs")!;
    expect(board.title).toBe("From the phone");
    expect(board.arrivedFrom).toBeNull();
    expect(board.items.find((item) => item.uid === dune!.uid)?.imageUrl).toBe(
      "https://pictures/pic-1",
    );
    expect(resolvePicture).toHaveBeenCalledWith("pic-1");
    // Known now: the next run leaves it alone.
    expect(await run()).toEqual({
      carried: 0,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
  });

  it("keeps both when both sides changed: theirs as a copy named after their device, ours sent over theirs", async () => {
    const { repository, account, run } = setUp();
    repository.save(films());
    await run();
    repository.save(rename(repository.get("films")!, "Mine", 200));
    const theirs: KeptBoard = {
      ...account.kept.get("films")!,
      revision: 2,
      title: "Theirs",
      deviceName: "Pixel 7",
      fingerprint: "elsewhere",
      publishedId: "p1",
    };
    account.kept.set("films", theirs);
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    const all = repository.all();
    expect(all).toHaveLength(2);
    const copy = all.find((board) => board.uid !== "films")!;
    expect(copy.title).toBe("Theirs");
    expect(copy.arrivedFrom).toBe("Pixel 7");
    expect(copy.publishedId).toBeNull();
    // Every uid of the copy is new, so the two never meet on the account.
    expect(copy.uid).toMatch(/^new-/);
    expect(copy.tiers.every((tier) => tier.uid.startsWith("new-"))).toBe(true);
    expect(copy.items.every((item) => item.uid.startsWith("new-"))).toBe(true);
    expect(account.keeps.at(-1)).toMatchObject({
      uid: "films",
      request: { basedOn: 2, title: "Mine" },
    });
    expect(repository.get("films")?.title).toBe("Mine");
  });

  it("keeps both as well when the account moved on between the index and the write", async () => {
    const { repository, account, run } = setUp();
    repository.save(films());
    await run();
    repository.save(rename(repository.get("films")!, "Mine", 200));
    // The index still says revision 1; the write finds revision 2 there.
    const theirs: KeptBoard = {
      ...account.kept.get("films")!,
      revision: 2,
      title: "Theirs",
      deviceName: "Pixel 7",
      fingerprint: "elsewhere",
    };
    account.refuseNextWith(theirs);
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(
      repository
        .all()
        .map((board) => board.title)
        .sort(),
    ).toEqual(["Mine", "Theirs"]);
    expect(account.keeps.slice(-2).map((keep) => keep.request.basedOn)).toEqual([1, 2]);
  });

  it("takes a refusal that hands back its own board as the receipt it missed", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    await run();
    const fingerprint = records.all()[0]!.fingerprint;
    // The account has it at revision 5 with the very same contents.
    const same = { ...account.kept.get("films")!, revision: 5, fingerprint };
    account.kept.set("films", same);
    records.remember({ uid: "films", revision: 1, fingerprint: "stale" });
    account.refuseNextWith(same);
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(repository.all()).toHaveLength(1);
    expect(records.all()[0]).toEqual({ uid: "films", revision: 5, fingerprint });
  });

  it("sends over a refusal that hands back the board as agreed, written again elsewhere, without a copy", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    await run();
    const agreed = records.all()[0]!.fingerprint;
    repository.save(rename(repository.get("films")!, "Mine", 200));
    // The phone saved what it was sent: revision 2, the contents agreed on.
    const echo: KeptBoard = {
      ...account.kept.get("films")!,
      revision: 2,
      deviceName: "Pixel 7",
      fingerprint: agreed,
    };
    account.refuseNextWith(echo);
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(repository.all().map((board) => board.title)).toEqual(["Mine"]);
    expect(account.keeps.slice(-2).map((keep) => keep.request.basedOn)).toEqual([1, 2]);
  });

  it("tells the account about a board removed for good here, and puts one removed elsewhere in the trash", async () => {
    const { repository, records, account, run } = setUp();
    repository.saveAll([films("a", "A"), films("b", "B")]);
    await run();
    repository.remove("a");
    const b = account.kept.get("b")!;
    account.kept.set("b", { ...b, deleted: true, revision: 2 });
    expect(await run()).toEqual({
      carried: 2,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(account.forgotten).toEqual(["a"]);
    // In the trash here, with the agreement on the marker: the next run does nothing.
    expect(repository.get("b")?.deletedAt).toBe(1000);
    expect(records.all().map((record) => [record.uid, record.revision])).toEqual([["b", 2]]);
    expect(await run()).toEqual({
      carried: 0,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(account.kept.get("b")?.deleted).toBe(true);
    // Emptied out of the trash here: the agreement goes too, and the account is not asked.
    repository.remove("b");
    await run();
    expect(records.all()).toEqual([]);
    expect(account.forgotten).toEqual(["a"]);
  });

  it("sends edits nobody else saw back over a marker instead of throwing them away", async () => {
    const { repository, account, run } = setUp();
    repository.save(films("d", "Doomed"));
    await run();
    repository.save(rename(repository.get("d")!, "Doomed, with my work", 2000));
    const d = account.kept.get("d")!;
    account.kept.set("d", { ...d, deleted: true, revision: 2 });
    await run();
    expect(repository.get("d")?.title).toBe("Doomed, with my work");
    expect(repository.get("d")?.deletedAt).toBeNull();
    expect(account.kept.get("d")).toMatchObject({ deleted: false, title: "Doomed, with my work" });
  });

  it("makes one copy of theirs however many times ours is refused after it", async () => {
    const { repository, account, run } = setUp();
    repository.save(films());
    await run();
    // Both sides moved: another device wrote rev 2, and the board here changed.
    account.holds({ ...films(), title: "Their films" }, 2, "Pixel 7", "theirs");
    repository.save(rename(repository.get("films")!, "My films", 2000));
    const keep = account.api.keep;
    account.api.keep = () => Promise.reject(new ApiFailure({ kind: "tooLarge", detail: null }));
    await run();
    await run();
    await run();
    const copies = repository.all().filter((board) => board.title === "Their films");
    expect(copies).toHaveLength(1);
    account.api.keep = keep;
    await run();
    expect(account.kept.get("films")?.title).toBe("My films");
    expect(repository.all().filter((board) => board.title === "Their films")).toHaveLength(1);
  });

  it("counts a step that failed and does not call the run complete", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    account.api.keep = () => Promise.reject(new ApiFailure({ kind: "unavailable" }));
    expect(await run()).toEqual({
      carried: 0,
      refused: 1,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(records.lastSyncedAt()).toBeNull();
  });

  it("names a board the account will go on refusing as it is, and why", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    repository.save({ ...films(), uid: "more", title: "One too many" });
    account.api.keep = (uid) =>
      Promise.reject(
        new ApiFailure(
          uid === "films"
            ? { kind: "tooLarge", detail: "Too many tiers" }
            : { kind: "tooManyBoards" },
        ),
      );
    const report = await run();
    expect(report.refused).toBe(2);
    expect([...report.refusals].sort((a, b) => a.uid.localeCompare(b.uid))).toEqual([
      { uid: "films", title: "Films", why: "tooLarge" },
      { uid: "more", title: "One too many", why: "tooManyBoards" },
    ]);
    expect(records.lastSyncedAt()).toBeNull();
  });

  it("drops a published id the account no longer lists, and leaves it when the lists could not be read", async () => {
    const { repository, run } = setUp(["p-still"]);
    repository.saveAll([
      { ...films("a", "A"), publishedId: "p-still" },
      { ...films("b", "B"), publishedId: "p-gone", authorName: "Danylo" },
    ]);
    await run();
    expect(repository.get("a")?.publishedId).toBe("p-still");
    // One's own again, not a copy saved from somebody else.
    expect(repository.get("b")).toMatchObject({ publishedId: null, authorName: null });

    const unsure = setUp(null);
    unsure.repository.save({ ...films("c", "C"), publishedId: "p-unknown" });
    await unsure.run();
    expect(unsure.repository.get("c")?.publishedId).toBe("p-unknown");
  });

  it("brings a board back over the account's marker when nothing here agreed about it", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    account.holds(films(), 2);
    account.kept.set("films", { ...account.kept.get("films")!, deleted: true });
    expect(await run()).toEqual({
      carried: 1,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: false,
    });
    expect(account.keeps[0]).toMatchObject({ uid: "films", request: { basedOn: 2 } });
    expect(account.kept.get("films")?.deleted).toBe(false);
    expect(records.all()).toHaveLength(1);
    expect(repository.get("films")).not.toBeNull();
  });

  it("leaves a restore for the next run when the board here moved while the copy was on its way", async () => {
    const { repository, records, account, run } = setUp();
    const mine = films();
    repository.save(mine);
    // Agreed at revision 1 with this very content; the account has since moved on.
    const fingerprint = await fingerprintOf(mine);
    records.remember({ uid: "films", revision: 1, fingerprint });
    account.holds({ ...mine, title: "Theirs" }, 2);
    // While the copy is on its way, the person renames the board here.
    const fetch = account.api.board;
    account.api.board = (uid) => {
      repository.save({ ...repository.get("films")!, title: "Mine, edited", editedAt: 2000 });
      return fetch(uid);
    };
    expect(await run()).toEqual({
      carried: 0,
      refused: 0,
      refusals: [],
      deferred: 1,
      cancelled: false,
    });
    expect(repository.get("films")?.title).toBe("Mine, edited");
    expect(records.all()).toEqual([{ uid: "films", revision: 1, fingerprint }]);

    // The next run sees a change on both sides and keeps both.
    account.api.board = fetch;
    expect(await run()).toMatchObject({ carried: 1, refused: 0, refusals: [], deferred: 0 });
    expect(
      repository
        .all()
        .map((board) => board.title)
        .sort(),
    ).toEqual(["Mine, edited", "Theirs"]);
  });

  it("stops at the boundary once no longer wanted, and writes nothing past it", async () => {
    const { repository, records, account, run } = setUp();
    repository.saveAll([films("a", "A"), films("b", "B")]);
    let wanted = true;
    const keep = account.api.keep;
    account.api.keep = async (uid, request) => {
      const answer = await keep(uid, request);
      wanted = false;
      return answer;
    };
    expect(await run({ stillWanted: () => wanted })).toEqual({
      carried: 0,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: true,
    });
    expect(account.keeps).toHaveLength(1);
    expect(records.all()).toEqual([]);
    expect(records.lastSyncedAt()).toBeNull();
  });

  it("defers a restore when the board here is edited while the fingerprints are computed", async () => {
    const { repository, records, account, run } = setUp();
    const mine = films();
    repository.save(mine);
    const fingerprint = await fingerprintOf(mine);
    records.remember({ uid: "films", revision: 1, fingerprint });
    account.holds({ ...mine, title: "Theirs" }, 2);
    // The copy's own fingerprint is the first wait inside the step: the edit lands there.
    const hooked = async (board: Board) => {
      if (board.title === "Theirs") {
        repository.save({ ...repository.get("films")!, title: "Mine, edited", editedAt: 2000 });
      }
      return fingerprintOf(board);
    };
    expect(await run({ fingerprintOf: hooked })).toEqual({
      carried: 0,
      refused: 0,
      refusals: [],
      deferred: 1,
      cancelled: false,
    });
    expect(repository.get("films")?.title).toBe("Mine, edited");
    expect(records.all()).toEqual([{ uid: "films", revision: 1, fingerprint }]);
  });

  it("writes nothing of an adopted board when the run stops while its fingerprint is computed", async () => {
    const { repository, records, account, run } = setUp();
    account.holds(films("theirs", "Theirs"), 1);
    let wanted = true;
    const hooked = async (board: Board) => {
      if (board.uid === "theirs") wanted = false;
      return fingerprintOf(board);
    };
    expect(await run({ fingerprintOf: hooked, stillWanted: () => wanted })).toEqual({
      carried: 0,
      refused: 0,
      refusals: [],
      deferred: 0,
      cancelled: true,
    });
    expect(repository.all()).toEqual([]);
    expect(records.all()).toEqual([]);
  });

  it("drops a published id gone from the account without writing over an edit made meanwhile", async () => {
    const { repository, account, run } = setUp([]);
    repository.saveAll([
      { ...films("a", "A"), publishedId: "p-gone" },
      { ...films("b", "B"), publishedId: "p-old" },
    ]);
    account.api.published = () => {
      // While the account is asked, the person renames one board and republishes the other.
      repository.save({ ...repository.get("a")!, title: "A, edited", editedAt: 2000 });
      repository.save({ ...repository.get("b")!, publishedId: "p-new", editedAt: 2000 });
      return Promise.resolve([]);
    };
    await run();
    expect(repository.get("a")).toMatchObject({ title: "A, edited", publishedId: null });
    // Republished meanwhile: not the id that was asked about, so it is left for the next run.
    expect(repository.get("b")?.publishedId).toBe("p-new");
  });

  it("gives a board back the list its publish made when the answer never came, found by the board's uid", async () => {
    const { repository, run } = setUp([
      { id: "p-lost", boardUid: "a", updatedAt: 800 },
      { id: "p-edited", boardUid: "b", updatedAt: 800 },
      // Two lists for one board: which one is its own cannot be told, so neither.
      { id: "p-one", boardUid: "c", updatedAt: 800 },
      { id: "p-two", boardUid: "c", updatedAt: 800 },
      // Already another board's, and a list of a board in the trash.
      { id: "p-claimed", boardUid: "d", updatedAt: 800 },
      { id: "p-trash", boardUid: "e", updatedAt: 800 },
    ]);
    const inSection = (board: Board, editedAt = 700): Board => ({
      ...board,
      category: "film_tv",
      editedAt,
    });
    repository.saveAll([
      inSection(films("a", "A")),
      inSection(films("b", "B"), 900),
      inSection(films("c", "C")),
      inSection(films("d", "D")),
      { ...inSection(films("e", "E")), deletedAt: 750 },
      { ...inSection(films("f", "F")), publishedId: "p-claimed" },
    ]);
    await run();
    expect(repository.get("a")).toMatchObject({
      publishedId: "p-lost",
      editedAt: 700,
      publishedEditedAt: 700,
    });
    // Changed after the list went out: Update still has that change to send.
    expect(repository.get("b")).toMatchObject({ publishedId: "p-edited", publishedEditedAt: 800 });
    expect(isBehind(repository.get("b")!)).toBe(true);
    expect(repository.get("c")?.publishedId).toBeNull();
    expect(repository.get("d")?.publishedId).toBeNull();
    expect(repository.get("e")?.publishedId).toBeNull();
    expect(repository.get("f")?.publishedId).toBe("p-claimed");
  });

  it("takes in a board whose cards have the uids of a board here: uids are the board's own", async () => {
    const { repository, account, run } = setUp();
    const here = films("here", "Here");
    repository.save(here);
    account.holds({ ...films("there", "There"), tiers: here.tiers, items: here.items });
    expect(await run()).toMatchObject({ refused: 0 });
    expect(repository.get("there")?.items.map((item) => item.uid)).toEqual(
      here.items.map((item) => item.uid),
    );
    expect(repository.get("here")?.items).toEqual(here.items);
  });
});
