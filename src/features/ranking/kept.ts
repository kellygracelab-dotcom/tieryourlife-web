import type { DraftStore } from "../board/draft";

export interface KeptRanking {
  code: string;
  claimToken: string;
  /** The account the ranking was handed to, once it has been. */
  claimedBy?: string;
}

export const KEPT_PREFIX = "tyl:ranking:";

export const keptKey = (listId: string): string => `${KEPT_PREFIX}${listId}`;

/** The ranking this device finished for a list, so the page can say "yours". */
export function readKept(store: DraftStore, listId: string): KeptRanking | null {
  const text = store.read(keptKey(listId));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const { code, claimToken, claimedBy } = parsed as Partial<KeptRanking>;
    if (typeof code !== "string" || typeof claimToken !== "string") return null;
    return typeof claimedBy === "string" ? { code, claimToken, claimedBy } : { code, claimToken };
  } catch {
    return null;
  }
}

export function writeKept(store: DraftStore, listId: string, kept: KeptRanking): void {
  store.write(keptKey(listId), JSON.stringify(kept));
}
