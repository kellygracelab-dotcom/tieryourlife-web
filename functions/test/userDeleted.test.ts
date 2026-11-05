import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  onUserDeleted,
  PAGE_SIZE,
  releaseRankings,
  scrubAuthor,
  type RankingStore,
} from "../src/userDeleted";

interface StoredRanking {
  ownerUid: string | null;
  ownerAnonymous: boolean;
  claimedAt?: number;
  listAuthorUid?: string;
  snapshot?: { authorName: string; authorPhotoUrl: string | null };
}

type Rankings = Map<string, StoredRanking>;

const RELEASED: StoredRanking = { ownerUid: null, ownerAnonymous: true };

const owned = (uid: string, count: number, extra: Partial<StoredRanking> = {}) =>
  Array.from({ length: count }, (_, i): [string, StoredRanking] => [
    `${uid}-${i}`,
    { ownerUid: uid, ownerAnonymous: false, ...extra },
  ]);

/** A store over plain maps that speaks the same verbs as Firestore; `cards` holds the codes with a card kept. */
function memoryStore(
  rankings: Rankings,
  quotas: Set<string>,
  failOnRelease = 0,
  cards = new Set<string>(),
  failOnScrub = 0,
) {
  const calls: string[] = [];
  let releases = 0;
  let scrubs = 0;
  const store: RankingStore<string> = {
    async ownedBy(uid, limit) {
      calls.push(`ownedBy ${limit}`);
      const codes: string[] = [];
      for (const [code, ranking] of rankings) {
        if (codes.length === limit) break;
        if (ranking.ownerUid === uid) codes.push(code);
      }
      return codes;
    },
    async release(codes) {
      calls.push(`release ${codes.length}`);
      if (++releases === failOnRelease) throw new Error("Firestore went away");
      for (const code of codes) rankings.set(code, { ...RELEASED });
    },
    async forgetQuota(uid) {
      calls.push(`forgetQuota ${uid}`);
      quotas.delete(uid);
    },
    async namingAuthor(uid, limit) {
      calls.push(`namingAuthor ${limit}`);
      return [...rankings]
        .filter(([, ranking]) => ranking.listAuthorUid === uid)
        .slice(0, limit)
        .map(([code]) => code);
    },
    async forgetCards(codes) {
      calls.push(`forgetCards ${codes.length}`);
      for (const code of codes) cards.delete(code);
    },
    async scrubAuthor(codes) {
      calls.push(`scrubAuthor ${codes.length}`);
      if (++scrubs === failOnScrub) throw new Error("Firestore went away");
      for (const code of codes) {
        const { listAuthorUid: _gone, ...rest } = rankings.get(code)!;
        rankings.set(code, { ...rest, snapshot: { authorName: "", authorPhotoUrl: null } });
      }
    },
  };
  return { store, calls };
}

const stillOwned = (rankings: Rankings, uid: string) =>
  [...rankings.values()].filter((ranking) => ranking.ownerUid === uid).length;

describe("releaseRankings", () => {
  it("touches nothing when the user owned no ranking", async () => {
    const rankings: Rankings = new Map(owned("other", 2, { claimedAt: 7 }));
    const before = structuredClone(rankings);
    const { store, calls } = memoryStore(rankings, new Set(["other"]));

    assert.equal(await releaseRankings(store, "gone"), 0);
    assert.deepEqual(rankings, before);
    assert.deepEqual(calls, [`ownedBy ${PAGE_SIZE}`, "forgetQuota gone"]);
  });

  it("forgets the quota even when nothing was owned", async () => {
    const quotas = new Set(["gone", "other"]);
    const { store } = memoryStore(new Map(), quotas);

    await releaseRankings(store, "gone");
    assert.deepEqual(quotas, new Set(["other"]));
  });

  it("releases page after page until the query comes back empty", async () => {
    const rankings: Rankings = new Map([
      ...owned("gone", 2 * PAGE_SIZE + 5, { claimedAt: 5 }),
      ...owned("other", 3, { claimedAt: 7 }),
    ]);
    const quotas = new Set(["gone", "other"]);
    const { store, calls } = memoryStore(rankings, quotas);

    assert.equal(await releaseRankings(store, "gone"), 2 * PAGE_SIZE + 5);
    assert.equal(stillOwned(rankings, "gone"), 0);
    for (const [code] of owned("gone", 2 * PAGE_SIZE + 5)) {
      assert.deepEqual(rankings.get(code), RELEASED);
    }
    assert.deepEqual(rankings.get("other-0"), {
      ownerUid: "other",
      ownerAnonymous: false,
      claimedAt: 7,
    });
    assert.deepEqual(quotas, new Set(["other"]));
    assert.deepEqual(calls, [
      `ownedBy ${PAGE_SIZE}`,
      `release ${PAGE_SIZE}`,
      `ownedBy ${PAGE_SIZE}`,
      `release ${PAGE_SIZE}`,
      `ownedBy ${PAGE_SIZE}`,
      "release 5",
      `ownedBy ${PAGE_SIZE}`,
      "forgetQuota gone",
    ]);
  });

  it("picks up where a failed run stopped, and a run after that changes nothing", async () => {
    const rankings: Rankings = new Map(owned("gone", PAGE_SIZE + 1));
    const quotas = new Set(["gone"]);

    const failing = memoryStore(rankings, quotas, 2);
    await assert.rejects(releaseRankings(failing.store, "gone"), /went away/);
    assert.equal(stillOwned(rankings, "gone"), 1);
    assert.ok(quotas.has("gone"));

    const retry = memoryStore(rankings, quotas);
    assert.equal(await releaseRankings(retry.store, "gone"), 1);
    assert.equal(stillOwned(rankings, "gone"), 0);
    assert.deepEqual(retry.calls, [
      `ownedBy ${PAGE_SIZE}`,
      "release 1",
      `ownedBy ${PAGE_SIZE}`,
      "forgetQuota gone",
    ]);
    assert.deepEqual(quotas, new Set());

    const settled = structuredClone(rankings);
    const again = memoryStore(rankings, quotas);
    assert.equal(await releaseRankings(again.store, "gone"), 0);
    assert.deepEqual(rankings, settled);
    assert.deepEqual(again.calls, [`ownedBy ${PAGE_SIZE}`, "forgetQuota gone"]);
  });
});

const OF_GONE: StoredRanking = {
  ownerUid: "reader",
  ownerAnonymous: false,
  listAuthorUid: "gone",
  snapshot: { authorName: "Alice Author", authorPhotoUrl: "https://lh3.example/alice.jpg" },
};

describe("scrubAuthor", () => {
  it("takes the author's name, photo and cards out of other people's rankings of their lists", async () => {
    const rankings: Rankings = new Map<string, StoredRanking>([
      ["a", OF_GONE],
      ["b", { ...OF_GONE, ownerUid: null, ownerAnonymous: true }],
      [
        "c",
        {
          ...OF_GONE,
          listAuthorUid: "other",
          snapshot: { authorName: "Bob", authorPhotoUrl: null },
        },
      ],
    ]);
    const cards = new Set(["a", "b", "c"]);
    const { store } = memoryStore(rankings, new Set(), 0, cards);

    assert.equal(await scrubAuthor(store, "gone"), 2);
    for (const code of ["a", "b"]) {
      const kept = rankings.get(code)!;
      assert.deepEqual(kept.snapshot, { authorName: "", authorPhotoUrl: null });
      assert.equal(kept.listAuthorUid, undefined);
    }
    // The reader keeps their ranking; another author's stays as it was.
    assert.equal(rankings.get("a")?.ownerUid, "reader");
    assert.deepEqual(rankings.get("c")?.snapshot, { authorName: "Bob", authorPhotoUrl: null });
    assert.deepEqual(cards, new Set(["c"]));
  });

  it("pages until nothing names the author, and a run after a failure finishes the job", async () => {
    const rankings: Rankings = new Map(
      Array.from({ length: PAGE_SIZE + 2 }, (_, i): [string, StoredRanking] => [`r-${i}`, OF_GONE]),
    );
    const failing = memoryStore(rankings, new Set(), 0, new Set(), 2);
    await assert.rejects(scrubAuthor(failing.store, "gone"), /went away/);

    const retry = memoryStore(rankings, new Set());
    assert.equal(await scrubAuthor(retry.store, "gone"), 2);
    assert.deepEqual(retry.calls, [
      `namingAuthor ${PAGE_SIZE}`,
      "forgetCards 2",
      "scrubAuthor 2",
      `namingAuthor ${PAGE_SIZE}`,
    ]);
    assert.ok([...rankings.values()].every((ranking) => ranking.listAuthorUid === undefined));
  });
});

describe("onUserDeleted", () => {
  it("is a first-generation auth delete trigger in europe-west1", () => {
    // The v1 SDK reads the project only when the endpoint is described.
    process.env.GCLOUD_PROJECT = "tieryourlife-test";
    const endpoint = onUserDeleted.__endpoint;
    assert.equal(endpoint.platform, "gcfv1");
    assert.deepEqual(endpoint.region, ["europe-west1"]);
    assert.equal(
      endpoint.eventTrigger?.eventType,
      "providers/firebase.auth/eventTypes/user.delete",
    );
    assert.deepEqual(endpoint.eventTrigger?.eventFilters, {
      resource: "projects/tieryourlife-test",
    });
  });
});
