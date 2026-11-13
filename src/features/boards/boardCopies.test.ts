import { describe, expect, it } from "vitest";
import type { KeepBoardRequest, KeptAnswer, KeptBoard, KeptBoardEntry } from "../../api/boards";
import { ApiFailure } from "../../api/errors";
import { memoryStore } from "../../lib/storage";
import { withCopies } from "./boardCopies";
import { fingerprintOf } from "./fingerprint";
import { addToPool, isBehind, newBoard, rename, type Board } from "./model";
import { boardsRepository } from "./repository";
import { syncBoards, type BoardsApi } from "./sync";
import { syncRecords } from "./syncRecords";

const uids = (prefix = "u") => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const DUNE = "https://image.tmdb.org/t/p/w500/dune.jpg";
const HEAT = "https://image.tmdb.org/t/p/w500/heat.jpg";
const AKIRA = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx47.png";
const OTHER = "https://img.test/other.jpg";
const ours = (name: string) =>
  `https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2Fcatalogue%2Fw-${name.padEnd(32, "0")}?alt=media`;
const COPIES = new Map([
  [DUNE, ours("d")],
  [HEAT, ours("e")],
  [AKIRA, ours("a")],
  [OTHER, ours("f")],
]);

/** A board with Dune credited by TMDB, Heat with no credit, Akira, a card without a picture and one's own photo. */
const films = (uid = "films"): Board => {
  const next = uids(`${uid}-`);
  const board = addToPool(
    newBoard(uid, "Films", 100, next),
    [
      {
        title: "Dune",
        imageUrl: DUNE,
        attribution: {
          source: "tmdb",
          id: "tmdb:movie:438631",
          link: "https://www.themoviedb.org/movie/438631",
        },
      },
      { title: "Heat", imageUrl: HEAT },
      { title: "Akira", imageUrl: AKIRA },
      { title: "Nothing", imageUrl: null },
      {
        title: "Holiday",
        imageUrl:
          "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/users%2Fme%2Fpictures%2Fh?alt=media",
        pictureId: "h",
      },
    ],
    100,
    next,
  );
  return { ...board, coverImageUrl: null, coverImageUrls: [DUNE, HEAT, OTHER] };
};

describe("withCopies", () => {
  it("shows each card from our copy, the catalogue address kept in its attribution", () => {
    const board = films();
    const moved = withCopies(board, COPIES);
    const [dune, heat, akira, nothing, holiday] = moved.items;
    expect(dune?.imageUrl).toBe(ours("d"));
    // The rest of its credit stays.
    expect(dune?.attribution).toEqual({
      source: "tmdb",
      id: "tmdb:movie:438631",
      link: "https://www.themoviedb.org/movie/438631",
      originalUrl: DUNE,
    });
    // None before: the catalogue's, by the address's host.
    expect(heat).toMatchObject({
      imageUrl: ours("e"),
      attribution: { source: "tmdb", originalUrl: HEAT },
    });
    expect(akira?.attribution).toEqual({ source: "anilist", originalUrl: AKIRA });
    expect(nothing).toBe(board.items[3]);
    expect(holiday).toBe(board.items[4]);
  });

  it("moves the cover and the collage, in their order", () => {
    const collage = withCopies(films(), COPIES);
    expect(collage.coverImageUrls).toEqual([ours("d"), ours("e"), ours("f")]);
    expect(collage.coverImageUrl).toBeNull();
    const single = withCopies({ ...films(), coverImageUrl: HEAT, coverImageUrls: [HEAT] }, COPIES);
    expect(single.coverImageUrl).toBe(ours("e"));
    expect(single.coverImageUrls).toEqual([ours("e")]);
  });

  it("is not an edit: the edit time stays, and a published board does not fall behind", () => {
    const published = { ...films(), publishedId: "L1", publishedEditedAt: 100 };
    const moved = withCopies(published, COPIES);
    expect(moved.editedAt).toBe(published.editedAt);
    expect(isBehind(moved)).toBe(false);
  });

  it("leaves a card whose catalogue it cannot tell, with no credit to keep, as it is", () => {
    const board = addToPool(
      newBoard("b", "B", 1, uids()),
      [{ title: "Other", imageUrl: OTHER }],
      1,
      uids("i"),
    );
    const moved = withCopies(board, COPIES);
    expect(moved.items[0]?.imageUrl).toBe(OTHER);
    // With a credit of its own it is kept, and moved.
    const credited = {
      ...board,
      items: board.items.map((item) => ({ ...item, attribution: { source: "web" } })),
    };
    expect(withCopies(credited, COPIES).items[0]).toMatchObject({
      imageUrl: ours("f"),
      attribution: { source: "web", originalUrl: OTHER },
    });
  });

  it("changes nothing a second time, nor for copies it does not show", () => {
    const once = withCopies(films(), COPIES);
    expect(withCopies(once, COPIES)).toBe(once);
    const board = films();
    expect(
      withCopies(board, new Map([["https://image.tmdb.org/t/p/w500/gone.jpg", ours("g")]])),
    ).toBe(board);
    expect(withCopies(board, new Map())).toBe(board);
  });

  it("moves the cards in the trash too", () => {
    const board = films();
    const trashed = { ...board, items: board.items.map((item) => ({ ...item, deletedAt: 50 })) };
    expect(withCopies(trashed, COPIES).items[0]?.imageUrl).toBe(ours("d"));
  });
});

/**
 * The account, in memory, as the Proxy keeps a board since #126: a catalogue
 * picture it has a copy of is stored as ours, the revision and fingerprint
 * stay the device's, and the answer names the copies.
 */
function copyingAccount() {
  const kept = new Map<string, KeptBoard>();
  const keeps: KeepBoardRequest[] = [];
  let duringKeep: (() => void) | null = null;
  let refuseNext: "conflict" | "offline" | null = null;
  const swap = (url: string | null) => (url === null ? null : (COPIES.get(url) ?? url));
  const api: BoardsApi = {
    index: () =>
      Promise.resolve({
        boards: [...kept.values()].map((board): KeptBoardEntry => ({
          uid: board.uid,
          revision: board.revision,
          updatedAt: board.updatedAt,
          deviceName: board.deviceName,
          deleted: board.deleted,
          fingerprint: board.fingerprint,
          title: board.title,
          itemCount: board.items.length,
        })),
        next: null,
      }),
    board: (uid) => {
      const board = kept.get(uid);
      return board === undefined
        ? Promise.reject(new ApiFailure({ kind: "notFound" }))
        : Promise.resolve(board);
    },
    keep: (uid, request) => {
      keeps.push(request);
      // Said before anything happens meanwhile, so what happens can be about the next write.
      const refusal = refuseNext;
      refuseNext = null;
      const during = duringKeep;
      duringKeep = null;
      during?.();
      const stored = kept.get(uid);
      if (refusal === "offline") return Promise.reject(new ApiFailure({ kind: "offline" }));
      if (refusal === "conflict" && stored !== undefined) {
        return Promise.reject(new ApiFailure({ kind: "conflict", board: stored }));
      }
      const shown = [
        request.coverImageUrl,
        ...request.coverImageUrls,
        ...request.items.map((item) => item.imageUrl),
      ];
      const copies = Object.fromEntries(
        shown.flatMap((url) => {
          const copy = url === null ? undefined : COPIES.get(url);
          return url === null || copy === undefined ? [] : [[url, copy]];
        }),
      );
      const revision =
        stored !== undefined && stored.fingerprint === request.fingerprint
          ? stored.revision
          : (stored?.revision ?? 0) + 1;
      const { basedOn: _basedOn, ...body } = request;
      kept.set(uid, {
        ...body,
        uid,
        revision,
        updatedAt: 500 + revision,
        deleted: false,
        coverImageUrl: swap(request.coverImageUrl),
        coverImageUrls: request.coverImageUrls.map((url) => swap(url) ?? url),
        items: request.items.map((item) => {
          const copy = item.imageUrl === null ? undefined : COPIES.get(item.imageUrl);
          return copy === undefined
            ? item
            : {
                ...item,
                imageUrl: copy,
                attribution: {
                  source: item.attribution?.source ?? "tmdb",
                  ...item.attribution,
                  originalUrl: item.imageUrl!,
                },
              };
        }),
      });
      const answer: KeptAnswer = {
        uid,
        revision,
        ...(Object.keys(copies).length === 0 ? {} : { copies: new Map(Object.entries(copies)) }),
      };
      return Promise.resolve(answer);
    },
    forget: () => Promise.resolve(),
    published: () => Promise.resolve([]),
  };
  return {
    api,
    kept,
    keeps,
    /** A board the account holds as a device wrote it. */
    holds: (board: Board, revision: number, fingerprint: string) => {
      kept.set(board.uid, {
        ...board,
        revision,
        updatedAt: 900,
        deviceName: "Pixel 7",
        deleted: false,
        fingerprint,
      });
    },
    /** Something to do while the next write is on its way, such as an edit. */
    whileKeeping: (act: () => void) => {
      duringKeep = act;
    },
    refuseNext: (how: "conflict" | "offline") => {
      refuseNext = how;
    },
  };
}

const setUp = () => {
  const store = memoryStore();
  const repository = boardsRepository(store);
  const records = syncRecords(store, "me");
  const account = copyingAccount();
  const run = () =>
    syncBoards({
      repository,
      api: account.api,
      records,
      deviceName: "Chrome on Linux",
      now: () => 1000,
      nextUid: uids("new-"),
    });
  return { repository, records, account, run };
};

describe("a board the account shows from our copies", () => {
  it("takes the copies and sends the board again as an ordinary edit on the answered revision", async () => {
    const { repository, records, account, run } = setUp();
    const board = films();
    repository.save(board);
    const report = await run();
    expect(report).toMatchObject({ refused: 0, carried: 1 });
    expect(account.keeps).toHaveLength(2);
    const [first, second] = account.keeps;
    expect(first).not.toHaveProperty("basedOn");
    expect(second?.basedOn).toBe(1);
    expect(second?.items[0]).toMatchObject({
      imageUrl: ours("d"),
      attribution: { source: "tmdb", originalUrl: DUNE },
    });
    expect(second?.coverImageUrls).toEqual([ours("d"), ours("e"), ours("f")]);
    // Here: shown from our copy, the edit time as it was, one board.
    const here = repository.get(board.uid)!;
    expect(repository.all()).toHaveLength(1);
    expect(here.items.map((item) => item.imageUrl).slice(0, 3)).toEqual([
      ours("d"),
      ours("e"),
      ours("a"),
    ]);
    expect(here.editedAt).toBe(board.editedAt);
    expect(records.all()).toEqual([
      { uid: board.uid, revision: 2, fingerprint: await fingerprintOf(here) },
    ]);
    expect(account.kept.get(board.uid)?.fingerprint).toBe(await fingerprintOf(here));
  });

  it("then has nothing to send: no second board, no write going round", async () => {
    const { repository, account, run } = setUp();
    repository.save(films());
    await run();
    await run();
    await run();
    expect(account.keeps).toHaveLength(2);
    expect(repository.all()).toHaveLength(1);
  });

  it("goes up with an edit made while the answer was on its way, the copies under it", async () => {
    const { repository, account, run } = setUp();
    const board = films();
    repository.save(board);
    account.whileKeeping(() =>
      repository.save(rename(repository.get(board.uid)!, "Films I love", 300)),
    );
    await run();
    expect(account.keeps).toHaveLength(2);
    expect(account.keeps[1]).toMatchObject({ basedOn: 1, title: "Films I love" });
    const here = repository.get(board.uid)!;
    expect(here.title).toBe("Films I love");
    expect(here.items[0]?.imageUrl).toBe(ours("d"));
    await run();
    expect(account.keeps).toHaveLength(2);
    expect(repository.all()).toHaveLength(1);
  });

  it("keeps an edit made while the second write was on its way, and sends it as any edit next time", async () => {
    const { repository, account, run } = setUp();
    const board = films();
    repository.save(board);
    // The first write goes; the edit lands while the second one is on its way.
    account.whileKeeping(() => {
      account.whileKeeping(() => repository.save(rename(repository.get(board.uid)!, "Later", 300)));
    });
    await run();
    const here = repository.get(board.uid)!;
    expect(here.title).toBe("Later");
    expect(here.items[1]?.imageUrl).toBe(ours("e"));
    await run();
    expect(account.keeps).toHaveLength(3);
    expect(account.keeps[2]).toMatchObject({ basedOn: 2, title: "Later" });
    expect(repository.all()).toHaveLength(1);
  });

  it("leaves the board as last agreed when the second write is refused: no second board after", async () => {
    const { repository, account, run } = setUp();
    const board = films();
    repository.save(board);
    account.whileKeeping(() => account.refuseNext("conflict"));
    const report = await run();
    expect(report.refused).toBe(0);
    expect(repository.get(board.uid)?.items[0]?.imageUrl).toBe(DUNE);
    // The account's board, with our addresses, comes down at most; nothing doubles.
    await run();
    expect(repository.all()).toHaveLength(1);
    expect(account.keeps.filter((request) => request.basedOn === undefined)).toHaveLength(1);
  });

  it("tries again with the next write when the second one could not go", async () => {
    const { repository, account, run } = setUp();
    const board = films();
    repository.save(board);
    account.whileKeeping(() => account.refuseNext("offline"));
    await run();
    expect(repository.get(board.uid)?.items[0]?.imageUrl).toBe(DUNE);
    repository.save(rename(repository.get(board.uid)!, "Edited", 400));
    await run();
    const here = repository.get(board.uid)!;
    expect(here.items[0]?.imageUrl).toBe(ours("d"));
    expect(repository.all()).toHaveLength(1);
    await run();
    expect(account.keeps.at(-1)?.items[0]?.imageUrl).toBe(ours("d"));
    expect(account.kept.get(board.uid)?.fingerprint).toBe(await fingerprintOf(here));
  });

  it("takes the copies after a refused write went up again, and on a board kept beside another's", async () => {
    const { repository, records, account, run } = setUp();
    const board = films();
    account.holds(board, 1, await fingerprintOf(board));
    records.remember({ uid: board.uid, revision: 1, fingerprint: await fingerprintOf(board) });
    repository.save(rename(board, "Renamed", 200));
    // The board as agreed, written again elsewhere: ours goes over it.
    account.refuseNext("conflict");
    await run();
    expect(account.keeps.map((request) => request.basedOn)).toEqual([1, 1, 2]);
    expect(repository.all()).toHaveLength(1);
    expect(repository.get(board.uid)?.items[0]?.imageUrl).toBe(ours("d"));

    // Changed on both sides: theirs comes down as a copy, ours goes up and takes its copies.
    const other = films("other");
    account.holds(other, 4, "theirs");
    repository.save(rename(other, "Mine", 200));
    records.remember({ uid: other.uid, revision: 3, fingerprint: "agreed" });
    await run();
    expect(repository.all()).toHaveLength(3);
    expect(repository.get(other.uid)?.items[0]?.imageUrl).toBe(ours("d"));
    expect(account.keeps.slice(3).map((request) => request.basedOn)).toEqual([4, 5]);
  });

  it("sends nothing more for an answer without copies", async () => {
    const { repository, account, run } = setUp();
    const next = uids("p-");
    repository.save(
      addToPool(newBoard("plain", "Plain", 1, next), [{ title: "A", imageUrl: null }], 1, next),
    );
    await run();
    expect(account.keeps).toHaveLength(1);
  });
});
