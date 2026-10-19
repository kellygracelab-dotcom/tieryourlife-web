import * as account from "../api/account";
import type { AdoptedGuest } from "../api/account";
import { searchEverywhere } from "../api/catalogue";
import { createApiClient } from "../api/client";
import * as community from "../api/community";
import type { FollowState, ReportRequest, SuggestedAuthor } from "../api/community";
import * as lists from "../api/lists";
import type { PublishRequest } from "../api/lists";
import * as moderation from "../api/moderation";
import type { BanLength, QueuedList } from "../api/moderation";
import * as rank from "../api/rank";
import type { MyRankings, Ranking, SavedRanking } from "../api/rank";
import type { CatalogueItem, FeedPage, FeedQuery, ListSummary, PublishedList } from "../api/types";
import { currentLocale } from "../strings";
import { tokenProviders } from "./firebase";
import { preloadedList, preloadedRanking } from "./preload";

/**
 * Every call the pages make, bound to the client that carries this browser's
 * tokens. Each operation has one name, the same here and in api/; the few
 * that add something of their own say what.
 */
export const api = createApiClient(tokenProviders);

type Rows = readonly (readonly number[])[];

// What the page function already put into the HTML needs no request, and
// therefore no App Check and no guest sign-in until Finish.
export const loadList = (id: string): Promise<PublishedList> => {
  const preloaded = preloadedList(id);
  return preloaded === null ? lists.loadList(api, id) : Promise.resolve(preloaded);
};

export const loadFeed = (query: FeedQuery): Promise<FeedPage> => lists.loadFeed(api, query);

// An account asks the network even when the page carries the ranking: only
// the server can say whether the ranking is theirs.
export const loadRanking = (code: string, asAccount = false): Promise<Ranking> => {
  const preloaded = asAccount ? null : preloadedRanking(code);
  return preloaded === null ? rank.loadRanking(api, code, asAccount) : Promise.resolve(preloaded);
};

export const rearrangeRanking = (code: string, rows: Rows): Promise<{ code: string }> =>
  rank.rearrangeRanking(api, code, rows);

export const keepRanking = (listId: string, rows: Rows): Promise<SavedRanking> =>
  rank.keepRanking(api, listId, rows);

export const carryGuest = (guestToken: string): Promise<AdoptedGuest> =>
  account.carryGuest(api, guestToken);

export const claimKept = (code: string, claimToken: string): Promise<{ code: string }> =>
  rank.claimKept(api, code, claimToken);

export const loadMyRankings = (): Promise<MyRankings> => rank.loadMyRankings(api);

export const removeRanking = (code: string): Promise<void> => rank.removeRanking(api, code);

export const loadMyLists = (): Promise<{ lists: ListSummary[] }> => lists.loadMyLists(api);

// The catalogue answers in the language the page is in.
export const findInCatalogue = (query: string): Promise<CatalogueItem[]> =>
  searchEverywhere(api, query, currentLocale());

export const publish = (request: PublishRequest): Promise<{ id: string }> =>
  lists.publish(api, request);

export const republish = (id: string, request: PublishRequest): Promise<{ id: string }> =>
  lists.republish(api, id, request);

export const unpublish = (id: string): Promise<void> => lists.unpublish(api, id);

export const refreshPublishedAuthor = (): Promise<{ updated: number }> =>
  account.refreshPublishedAuthor(api);

export const report = (id: string, request: ReportRequest): Promise<void> =>
  community.report(api, id, request);

export const loadReports = (): Promise<{ reports: QueuedList[] }> => moderation.loadReports(api);

export const followState = (authorUid: string): Promise<FollowState> =>
  community.followState(api, authorUid);

export const followAuthor = (authorUid: string): Promise<{ following: true }> =>
  community.followAuthor(api, authorUid);

export const unfollowAuthor = (authorUid: string): Promise<{ following: false }> =>
  community.unfollowAuthor(api, authorUid);

export const suggestedAuthors = (): Promise<{ authors: SuggestedAuthor[] }> =>
  community.suggestedAuthors(api);

export const takeDownList = (id: string, ban: BanLength | null): Promise<void> =>
  moderation.takeDownList(api, id, ban);

export const leaveListUp = (id: string): Promise<void> => moderation.leaveListUp(api, id);

export const eraseMyAccount = (): Promise<void> => account.eraseMyAccount(api);

// The only thing "popular" counts. Once per person, and never worth failing
// a finished ranking over.
export const noteTake = (listId: string): Promise<void> =>
  lists.recordTake(api, listId).then(
    () => undefined,
    () => undefined,
  );
