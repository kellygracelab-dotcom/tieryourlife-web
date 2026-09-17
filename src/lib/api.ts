import { eraseAccount, refreshAuthor } from "../api/account";
import { createApiClient } from "../api/client";
import { reportList, type ReportRequest } from "../api/community";
import { adoptGuest, type AdoptedGuest } from "../api/guest";
import { searchCatalogue, type CatalogueItem } from "../api/catalogue";
import {
  getFeed,
  getList,
  getMyLists,
  publishList,
  recordTake,
  republishList,
  unpublishList,
  type PublishRequest,
} from "../api/lists";
import {
  claimRanking,
  getMyRankings,
  getRanking,
  saveRanking,
  type MyRankings,
  type Ranking,
  type SavedRanking,
  updateRanking,
} from "../api/rank";
import type { FeedPage, FeedQuery, ListSummary, PublishedList } from "../api/types";
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

// An account asks the network even when the page carries the ranking: only
// the server can say whether the ranking is theirs.
export const loadRanking = (code: string, asAccount = false): Promise<Ranking> => {
  const preloaded = asAccount ? null : preloadedRanking(code);
  return preloaded === null ? getRanking(api, code, asAccount) : Promise.resolve(preloaded);
};

export const rearrangeRanking = (
  code: string,
  rows: readonly (readonly number[])[],
): Promise<{ code: string }> => updateRanking(api, code, rows);

export const keepRanking = (
  listId: string,
  rows: readonly (readonly number[])[],
): Promise<SavedRanking> => saveRanking(api, listId, rows);

export const carryGuest = (guestToken: string): Promise<AdoptedGuest> =>
  adoptGuest(api, guestToken);

export const claimKept = (code: string, claimToken: string): Promise<{ code: string }> =>
  claimRanking(api, code, claimToken);

export const loadMyRankings = (): Promise<MyRankings> => getMyRankings(api);

export const loadMyLists = (): Promise<{ lists: ListSummary[] }> => getMyLists(api);

export const findInCatalogue = (query: string): Promise<CatalogueItem[]> =>
  searchCatalogue(api, query);

export const publish = (request: PublishRequest): Promise<{ id: string }> =>
  publishList(api, request);

export const republish = (id: string, request: PublishRequest): Promise<{ id: string }> =>
  republishList(api, id, request);

export const unpublish = (id: string): Promise<void> => unpublishList(api, id);

export const refreshPublishedAuthor = (): Promise<{ updated: number }> => refreshAuthor(api);

export const report = (id: string, request: ReportRequest): Promise<void> =>
  reportList(api, id, request);

export const eraseMyAccount = (): Promise<void> => eraseAccount(api);

// The only thing "popular" counts. Once per person, and never worth failing
// a finished ranking over.
export const noteTake = (listId: string): Promise<void> =>
  recordTake(api, listId).then(
    () => undefined,
    () => undefined,
  );
