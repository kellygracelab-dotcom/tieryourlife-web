import { createApiClient } from "../api/client";
import { adoptGuest, type AdoptedGuest } from "../api/guest";
import { getFeed, getList, recordTake } from "../api/lists";
import { getRanking, saveRanking, type Ranking, type SavedRanking } from "../api/rank";
import type { FeedPage, FeedQuery, PublishedList } from "../api/types";
import { tokenProviders } from "./firebase";
import { preloadedList, preloadedRanking } from "./preload";

export const api = createApiClient(tokenProviders);

// What the page function already put into the HTML needs no request, and
// therefore no App Check and no guest sign-in until Finish.
export const loadList = (id: string): Promise<PublishedList> => {
  const preloaded = preloadedList(id);
  return preloaded === null ? getList(api, id) : Promise.resolve(preloaded);
};

export const loadFeed = (query: FeedQuery): Promise<FeedPage> => getFeed(api, query);

export const loadRanking = (code: string): Promise<Ranking> => {
  const preloaded = preloadedRanking(code);
  return preloaded === null ? getRanking(api, code) : Promise.resolve(preloaded);
};

export const keepRanking = (
  listId: string,
  rows: readonly (readonly number[])[],
): Promise<SavedRanking> => saveRanking(api, listId, rows);

export const carryGuest = (guestToken: string): Promise<AdoptedGuest> =>
  adoptGuest(api, guestToken);

// The only thing "popular" counts. Once per person, and never worth failing
// a finished ranking over.
export const noteTake = (listId: string): Promise<void> =>
  recordTake(api, listId).then(
    () => undefined,
    () => undefined,
  );
