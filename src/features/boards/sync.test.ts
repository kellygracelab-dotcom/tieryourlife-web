import { describe, expect, it, vi } from "vitest";
import type { KeepBoardRequest, KeptBoard, KeptBoardEntry } from "../../api/boards";
import { ApiFailure } from "../../api/errors";
import { memoryStore } from "../../lib/storage";
import { addToPool, liveItems, newBoard, rename, setFavourite, type Board } from "./model";
import { boardsRepository } from "./repository";
import { syncBoards, type BoardsApi } from "./sync";
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

/** The account, in memory: what it keeps, what it was asked, and a way to make it refuse. */
function fakeAccount(published: string[] | null = []) {
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
    published: () => Promise.resolve(published),
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

const setUp = (published: string[] | null = []) => {
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
    expect(await run()).toEqual({ carried: 1, refused: 0 });
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
    expect(records.all()).toEqual([
      { uid: "films", revision: 1, fingerprint: request.fingerprint },
    ]);
    expect(records.lastSyncedAt()).toBe(1000);

    // A second run with nothing changed sends nothing: the one step is writing
    // down that both sides still agree.
    expect(await run()).toEqual({ carried: 1, refused: 0 });
    expect(account.keeps).toHaveLength(1);
  });

  it("sends a board changed here over the revision it was working from", async () => {
    const { repository, account, run } = setUp();
    repository.save(films());
    await run();
    repository.save(rename(repository.get("films")!, "Films I like", 200));
    expect(await run()).toEqual({ carried: 1, refused: 0 });
    expect(account.keeps[1]).toMatchObject({
      uid: "films",
      request: { basedOn: 1, title: "Films I like" },
    });
  });

  it("takes the account's version when only the account moved on, and keeps the star", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    await run();
    repository.save(setFavourite(repository.get("films")!, 7));
    // Another device renamed it: revision 2 on the account.
    const theirs = account.kept.get("films")!;
    account.kept.set("films", {
      ...theirs,
      revision: 2,
      title: "Their name",
      fingerprint: "other",
    });
    expect(await run()).toEqual({ carried: 1, refused: 0 });
    const board = repository.get("films")!;
    expect(board.title).toBe("Their name");
    expect(board.favouritedAt).toBe(7);
    expect(records.all()[0]?.revision).toBe(2);
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
    expect(await run({ resolvePicture })).toEqual({ carried: 1, refused: 0 });
    const board = repository.get("theirs")!;
    expect(board.title).toBe("From the phone");
    expect(board.arrivedFrom).toBeNull();
    expect(board.items.find((item) => item.uid === dune!.uid)?.imageUrl).toBe(
      "https://pictures/pic-1",
    );
    expect(resolvePicture).toHaveBeenCalledWith("pic-1");
    // Known now: the next run leaves it alone.
    expect(await run()).toEqual({ carried: 0, refused: 0 });
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
    expect(await run()).toEqual({ carried: 1, refused: 0 });
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
    expect(await run()).toEqual({ carried: 1, refused: 0 });
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
    expect(await run()).toEqual({ carried: 1, refused: 0 });
    expect(repository.all()).toHaveLength(1);
    expect(records.all()[0]).toEqual({ uid: "films", revision: 5, fingerprint });
  });

  it("tells the account about a board removed for good here, and lets go of one removed elsewhere", async () => {
    const { repository, records, account, run } = setUp();
    repository.saveAll([films("a", "A"), films("b", "B")]);
    await run();
    repository.remove("a");
    const b = account.kept.get("b")!;
    account.kept.set("b", { ...b, deleted: true, revision: 2 });
    expect(await run()).toEqual({ carried: 2, refused: 0 });
    expect(account.forgotten).toEqual(["a"]);
    expect(repository.get("b")).toBeNull();
    expect(records.all()).toEqual([]);
  });

  it("counts a step that failed and does not call the run complete", async () => {
    const { repository, records, account, run } = setUp();
    repository.save(films());
    account.api.keep = () => Promise.reject(new ApiFailure({ kind: "unavailable" }));
    expect(await run()).toEqual({ carried: 0, refused: 1 });
    expect(records.lastSyncedAt()).toBeNull();
  });

  it("drops a published id the account no longer lists, and leaves it when the lists could not be read", async () => {
    const { repository, run } = setUp(["p-still"]);
    repository.saveAll([
      { ...films("a", "A"), publishedId: "p-still" },
      { ...films("b", "B"), publishedId: "p-gone" },
    ]);
    await run();
    expect(repository.get("a")?.publishedId).toBe("p-still");
    expect(repository.get("b")?.publishedId).toBeNull();

    const unsure = setUp(null);
    unsure.repository.save({ ...films("c", "C"), publishedId: "p-unknown" });
    await unsure.run();
    expect(unsure.repository.get("c")?.publishedId).toBe("p-unknown");
  });
});
