import type { DraftStore } from "../board/draft";

export interface KeptRanking {
  code: string;
  claimToken: string;
}

export const keptKey = (listId: string): string => `tyl:ranking:${listId}`;

/** The ranking this device finished for a list, so the page can say "yours". */
export function readKept(store: DraftStore, listId: string): KeptRanking | null {
  const text = store.read(keptKey(listId));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const { code, claimToken } = parsed as Partial<KeptRanking>;
    return typeof code === "string" && typeof claimToken === "string" ? { code, claimToken } : null;
  } catch {
    return null;
  }
}

export function writeKept(store: DraftStore, listId: string, kept: KeptRanking): void {
  store.write(keptKey(listId), JSON.stringify(kept));
}
