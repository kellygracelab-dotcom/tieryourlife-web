import { FieldValue, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { region } from "firebase-functions/v1";

const RANKINGS = "rankings";
const QUOTA = "rankQuota";

/** Firestore commits at most 500 writes in one batch; a page of 300 stays well inside. */
export const PAGE_SIZE = 300;

/**
 * What releasing needs from the database, small enough to fake in a test: the
 * loop and its idempotency live in releaseRankings, the Firestore calls in
 * firestoreStore.
 */
export interface RankingStore<Ref> {
  /** Up to `limit` rankings still owned by `uid`, in no particular order. */
  ownedBy(uid: string, limit: number): Promise<Ref[]>;
  /** Leaves these rankings without an owner, so ownedBy stops returning them. */
  release(refs: Ref[]): Promise<void>;
  forgetQuota(uid: string): Promise<void>;
}

/**
 * A deleted user's rankings stay, as every ranking page promises; only nobody
 * owns them any more. Pages until the query comes back empty, so a second run
 * after a crash, or a duplicate delivery of the event, finds nothing left to do.
 */
export async function releaseRankings<Ref>(store: RankingStore<Ref>, uid: string): Promise<number> {
  let released = 0;
  for (;;) {
    const refs = await store.ownedBy(uid, PAGE_SIZE);
    if (refs.length === 0) break;
    await store.release(refs);
    released += refs.length;
  }
  await store.forgetQuota(uid);
  return released;
}

export function firestoreStore(db = getFirestore()): RankingStore<DocumentReference> {
  return {
    async ownedBy(uid, limit) {
      const page = await db.collection(RANKINGS).where("ownerUid", "==", uid).limit(limit).get();
      return page.docs.map((doc) => doc.ref);
    },
    async release(refs) {
      const batch = db.batch();
      for (const ref of refs) {
        // Deleting a field that is not there is a no-op, so no read comes first.
        batch.update(ref, { ownerUid: null, ownerAnonymous: true, claimedAt: FieldValue.delete() });
      }
      await batch.commit();
    },
    async forgetQuota(uid) {
      await db.collection(QUOTA).doc(uid).delete();
    },
  };
}

export const onUserDeleted = region("europe-west1")
  .auth.user()
  .onDelete(async (user) => {
    const released = await releaseRankings(firestoreStore(), user.uid);
    console.log(`User ${user.uid} deleted: ${released} ranking(s) released`);
  });
