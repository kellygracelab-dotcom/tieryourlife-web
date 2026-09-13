import { claimKept } from "../../lib/api";
import type { DraftStore } from "../board/draft";
import { errorOf } from "../list/useResource";
import { KEPT_PREFIX, readKept, writeKept } from "./kept";

export type Claim = (code: string, claimToken: string) => Promise<unknown>;

/**
 * Hands every ranking this device finished to the account that just signed
 * in. A token the server no longer accepts is forgotten; anything else that
 * fails is tried again at the next sign-in.
 */
export async function claimKeptRankings(
  store: DraftStore,
  uid: string,
  claim: Claim = claimKept,
): Promise<number> {
  const keys = (store.keys?.() ?? []).filter((key) => key.startsWith(KEPT_PREFIX));
  let claimed = 0;
  for (const key of keys) {
    const listId = key.slice(KEPT_PREFIX.length);
    const kept = readKept(store, listId);
    if (kept === null || kept.claimedBy === uid) continue;
    try {
      await claim(kept.code, kept.claimToken);
      writeKept(store, listId, { ...kept, claimedBy: uid });
      claimed += 1;
    } catch (reason) {
      const { kind } = errorOf(reason);
      if (kind === "notYours" || kind === "notFound") store.remove(key);
    }
  }
  return claimed;
}
