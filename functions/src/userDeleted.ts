import { FieldValue, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { region } from "firebase-functions/v1";
import { discardOlderCopies } from "./shareImage";

const RANKINGS = "rankings";
const QUOTA = "rankQuota";

/** Firestore commits at most 500 writes in one batch; a page of 300 stays well inside. */
export const PAGE_SIZE = 300;

/**
 * What releasing and scrubbing need from the database, small enough to fake in
 * a test: the loops and their idempotency live in releaseRankings and
 * scrubAuthor, the Firestore calls in firestoreStore.
 */
export interface RankingStore<Ref> {
  /** Up to `limit` rankings still owned by `uid`, in no particular order. */
  ownedBy(uid: string, limit: number): Promise<Ref[]>;
  /** Leaves these rankings without an owner, so ownedBy stops returning them. */
  release(refs: Ref[]): Promise<void>;
  forgetQuota(uid: string): Promise<void>;
  /** Up to `limit` rankings, anybody's, whose snapshot names `uid` as the list's author. */
  namingAuthor(uid: string, limit: number): Promise<Ref[]>;
  /** Takes the share cards of these rankings off the shelf; they are drawn again without the name. */
  forgetCards(refs: Ref[]): Promise<void>;
  /** Takes the author's name and photo out of these snapshots, so namingAuthor stops returning them. */
  scrubAuthor(refs: Ref[]): Promise<void>;
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

/**
 * Other people's rankings of a deleted user's lists stay, as the reader's
 * own; the author's name and photo leave them, as the account's erasure
 * promises, and so do the cards drawn with them. The cards go first: a run
 * that stops between the two still finds the rankings, and a card drawn in
 * between draws no name, since the lists went before the account did.
 */
export async function scrubAuthor<Ref>(store: RankingStore<Ref>, uid: string): Promise<number> {
  let scrubbed = 0;
  for (;;) {
    const refs = await store.namingAuthor(uid, PAGE_SIZE);
    if (refs.length === 0) break;
    await store.forgetCards(refs);
    await store.scrubAuthor(refs);
    scrubbed += refs.length;
  }
  return scrubbed;
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
    async namingAuthor(uid, limit) {
      const page = await db
        .collection(RANKINGS)
        .where("listAuthorUid", "==", uid)
        .limit(limit)
        .get();
      return page.docs.map((doc) => doc.ref);
    },
    async forgetCards(refs) {
      const bucket = getStorage().bucket();
      await Promise.all(refs.map((ref) => discardOlderCopies(bucket, "r", ref.id, "")));
    },
    async scrubAuthor(refs) {
      const batch = db.batch();
      for (const ref of refs) {
        batch.update(ref, {
          "snapshot.authorName": "",
          "snapshot.authorPhotoUrl": null,
          listAuthorUid: FieldValue.delete(),
        });
      }
      await batch.commit();
    },
  };
}

export const onUserDeleted = region("europe-west1")
  .auth.user()
  .onDelete(async (user) => {
    const store = firestoreStore();
    const released = await releaseRankings(store, user.uid);
    const scrubbed = await scrubAuthor(store, user.uid);
    console.log(
      `User ${user.uid} deleted: ${released} ranking(s) released, ${scrubbed} cleared of their name`,
    );
  });
