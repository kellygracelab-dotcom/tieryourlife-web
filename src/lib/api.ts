import { createApiClient } from "../api/client";
import { getList, recordTake } from "../api/lists";
import { getRanking, saveRanking, type Ranking, type SavedRanking } from "../api/rank";
import type { PublishedList } from "../api/types";
import { tokenProviders } from "./firebase";

export const api = createApiClient(tokenProviders);

export const loadList = (id: string): Promise<PublishedList> => getList(api, id);

export const loadRanking = (code: string): Promise<Ranking> => getRanking(api, code);

export const keepRanking = (
  listId: string,
  rows: readonly (readonly number[])[],
): Promise<SavedRanking> => saveRanking(api, listId, rows);

// The only thing "popular" counts. Once per person, and never worth failing
// a finished ranking over.
export const noteTake = (listId: string): Promise<void> =>
  recordTake(api, listId).then(
    () => undefined,
    () => undefined,
  );
