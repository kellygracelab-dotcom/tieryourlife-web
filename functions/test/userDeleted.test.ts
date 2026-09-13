import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onUserDeleted, PAGE_SIZE, releaseRankings, type RankingStore } from "../src/userDeleted";

interface StoredRanking {
  ownerUid: string | null;
  ownerAnonymous: boolean;
  claimedAt?: number;
}

type Rankings = Map<string, StoredRanking>;

const RELEASED: StoredRanking = { ownerUid: null, ownerAnonymous: true };

const owned = (uid: string, count: number, extra: Partial<StoredRanking> = {}) =>
  Array.from({ length: count }, (_, i): [string, StoredRanking] => [
    `${uid}-${i}`,
    { ownerUid: uid, ownerAnonymous: false, ...extra },
  ]);

/** A store over plain maps that speaks the same three verbs as Firestore. */
function memoryStore(rankings: Rankings, quotas: Set<string>, failOnRelease = 0) {
  const calls: string[] = [];
  let releases = 0;
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
