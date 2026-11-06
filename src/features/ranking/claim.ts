import { claimKept } from "../../lib/api";
import type { KeyValueStore } from "../../lib/storage";
import { errorOf } from "../../api/errors";
import { KEPT_PREFIX, readKept, writeKept } from "./kept";

export type Claim = (code: string, claimToken: string) => Promise<unknown>;

/**
 * Hands every ranking a guest finished on this device to the account that
 * just signed in. One an account finished, or was handed already, is that
 * account's and is never asked for by another: once that account is
 * deleted the server keeps the ranking for nobody, and the next person on a
 * shared browser would take it. A token the server no longer accepts is
 * forgotten. A ranking another account already keeps stays on the device,
 * but the account that was refused does not ask again. Anything else that
 * fails is tried again at the next sign-in.
 */
export async function claimKeptRankings(
  store: KeyValueStore,
  uid: string,
  claim: Claim = claimKept,
): Promise<number> {
  const keys = (store.keys?.() ?? []).filter((key) => key.startsWith(KEPT_PREFIX));
  let claimed = 0;
  for (const key of keys) {
    const listId = key.slice(KEPT_PREFIX.length);
    const kept = readKept(store, listId);
    if (kept === null || kept.claimedBy !== undefined || kept.refusedTo === uid) continue;
    try {
      await claim(kept.code, kept.claimToken);
      writeKept(store, listId, { ...kept, claimedBy: uid });
      claimed += 1;
    } catch (reason) {
      const { kind } = errorOf(reason);
      if (kind === "notYours" || kind === "notFound") store.remove(key);
      else if (kind === "conflict") writeKept(store, listId, { ...kept, refusedTo: uid });
    }
  }
  return claimed;
}
