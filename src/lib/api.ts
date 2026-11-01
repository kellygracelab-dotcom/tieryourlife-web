import * as account from "../api/account";
import * as admin from "../api/admin";
import type {
  AdminList,
  AdminListsQuery,
  AdminSections,
  AnonymousList,
  Candidate,
  Moderator,
  PendingTopic,
  ProposedSection,
  NameCheck,
  SectionChanges,
  ListMove,
  SectionDraft,
  FinishCall,
  HouseAnswer,
  TopicApproval,
  TopicChanges,
  TopicDecision,
  TopicDraft,
} from "../api/admin";
import * as boards from "../api/boards";
import type { KeepBoardRequest, KeptBoard, KeptBoardIndex } from "../api/boards";
import type { AdoptedGuest } from "../api/account";
import { searchEverywhere } from "../api/catalogue";
import { createApiClient } from "../api/client";
import * as community from "../api/community";
import type {
  Following,
  FollowState,
  RankingsPage,
  ReaderRanking,
  ReportRequest,
  SuggestedAuthor,
} from "../api/community";
import * as lists from "../api/lists";
import type { MyList, PublishRequest } from "../api/lists";
import * as moderation from "../api/moderation";
import type { BanLength, QueuedList } from "../api/moderation";
import * as rank from "../api/rank";
import * as sections from "../api/sections";
import type { SectionProposal, SectionStats, Topic } from "../api/sections";
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

/**
 * Whether the page's own copy of a list leaves out who wrote it: then only
 * the proxy can tell someone signed in that the list is theirs.
 */
export const preloadHidesAuthor = (id: string): boolean => preloadedList(id)?.anonymous === true;

// What the page function already put into the HTML needs no request, and
// therefore no App Check and no guest sign-in until Finish. An account asks
// the network for a list without its author's name, which may be its own.
export const loadList = (id: string, asAccount = false): Promise<PublishedList> => {
  const preloaded = preloadedList(id);
  return preloaded === null || (asAccount && preloaded.anonymous === true)
    ? lists.loadList(api, id)
    : Promise.resolve(lists.publishedListOf(preloaded));
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

export const loadMyLists = (): Promise<{ lists: MyList[] }> => lists.loadMyLists(api);

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

export const loadListRankings = (
  listId: string,
  after: string | null = null,
): Promise<RankingsPage> => community.loadListRankings(api, listId, after);

export const withdrawListRanking = (listId: string): Promise<void> =>
  community.withdrawListRanking(api, listId);

/** A reader's finished placing, among the list's rankings where the app shows them. */
export const keepListRanking = (
  list: Pick<PublishedList, "id" | "items" | "tiers">,
  rows: readonly (readonly number[])[],
): Promise<ReaderRanking> =>
  community.keepListRanking(api, list.id, {
    tierLabels: list.tiers.map((tier) => tier.label),
    rows: community.rowsOf(rows, list.tiers.length, list.items.length),
  });

export const loadFollowing = (): Promise<Following> => community.loadFollowing(api);

export const makeFace = (pictureId: string): Promise<{ url: string }> =>
  community.makeFace(api, pictureId);

export const suggestedAuthors = (): Promise<{ authors: SuggestedAuthor[] }> =>
  community.suggestedAuthors(api);

export const loadSections = (): Promise<{ sections: SectionStats[] }> => sections.loadSections(api);

export const loadSection = (id: string): Promise<SectionStats> => sections.loadSection(api, id);

export const followSection = (id: string): Promise<{ following: true }> =>
  sections.followSection(api, id);

export const unfollowSection = (id: string): Promise<{ following: false }> =>
  sections.unfollowSection(api, id);

export const proposeSection = (proposal: SectionProposal): Promise<SectionStats> =>
  sections.proposeSection(api, proposal);

export const withdrawSectionProposal = (id: string): Promise<void> =>
  sections.withdrawSectionProposal(api, id);

export const loadTopics = (section: string, limit?: number): Promise<{ topics: Topic[] }> =>
  sections.loadTopics(api, section, limit);

export const loadMyTopics = (): Promise<{ topics: Topic[] }> => sections.loadMyTopics(api);

export const loadTopic = (id: string): Promise<Topic> => sections.loadTopic(api, id);

export const followTopic = (id: string): Promise<{ following: true }> =>
  sections.followTopic(api, id);

export const unfollowTopic = (id: string): Promise<{ following: false }> =>
  sections.unfollowTopic(api, id);

export const takeDownList = (id: string, ban: BanLength | null): Promise<void> =>
  moderation.takeDownList(api, id, ban);

export const leaveListUp = (id: string): Promise<void> => moderation.leaveListUp(api, id);

export const eraseMyAccount = (): Promise<void> => account.eraseMyAccount(api);

export const loadBoardIndex = (after: string | null = null): Promise<KeptBoardIndex> =>
  boards.loadBoardIndex(api, after);

export const loadKeptBoard = (uid: string): Promise<KeptBoard> => boards.loadKeptBoard(api, uid);

export const keepBoard = (
  uid: string,
  request: KeepBoardRequest,
): Promise<{ uid: string; revision: number }> => boards.keepBoard(api, uid, request);

export const forgetBoard = (uid: string): Promise<void> => boards.forgetBoard(api, uid);

// The only thing "popular" counts. Once per person, and never worth failing
// a finished ranking over.
export const noteTake = (listId: string): Promise<void> =>
  lists.recordTake(api, listId).then(
    () => undefined,
    () => undefined,
  );

export const loadAdminSections = (): Promise<AdminSections> => admin.loadAdminSections(api);

export const saveSectionOrder = (
  ids: string[],
  hidden: string[],
  version: number | undefined,
): Promise<{ version: number }> => admin.saveSectionOrder(api, ids, hidden, version);

export const createSection = (draft: SectionDraft): Promise<SectionStats> =>
  admin.createSection(api, draft);

export const editSection = (id: string, draft: SectionChanges): Promise<SectionStats> =>
  admin.editSection(api, id, draft);

export const deleteSection = (id: string): Promise<void> => admin.deleteSection(api, id);

export const loadSectionQueue = (): Promise<{ sections: ProposedSection[] }> =>
  admin.loadSectionQueue(api);

export const approveSection = (
  id: string,
  changes?: Partial<SectionDraft>,
): Promise<SectionStats> => admin.approveSection(api, id, changes);

export const declineSection = (id: string, note: string | null): Promise<void> =>
  admin.declineSection(api, id, note);

export const mergeSection = (id: string, into: string): Promise<void> =>
  admin.mergeSection(api, id, into);

export const approveSectionAsTopic = (
  id: string,
  approval: TopicApproval,
): Promise<{ topic: Topic | null; proposal: SectionStats | null }> =>
  admin.approveSectionAsTopic(api, id, approval);

export const finishDecision = (id: string, finish: FinishCall): Promise<unknown> =>
  admin.finishDecision(api, id, finish);

export const mergeSectionIntoTopic = (
  id: string,
  topic: string,
): Promise<{ topic: Topic | null; proposal: SectionStats | null }> =>
  admin.mergeSectionIntoTopic(api, id, topic);

export const checkSectionName = (name: string): Promise<NameCheck> =>
  admin.checkSectionName(api, name);

export const loadTopicQueue = (): Promise<{ topics: PendingTopic[] }> => admin.loadTopicQueue(api);

export const decideTopic = (id: string, decision: TopicDecision): Promise<void> =>
  admin.decideTopic(api, id, decision);

export const createTopic = (draft: TopicDraft): Promise<Topic> => admin.createTopic(api, draft);

export const editTopic = (id: string, draft: TopicChanges): Promise<Topic> =>
  admin.editTopic(api, id, draft);

export const deleteTopic = (id: string): Promise<void> => admin.deleteTopic(api, id);

export const loadModerators = (): Promise<{ moderators: Moderator[] }> => admin.loadModerators(api);

export const appointModerator = (who: {
  uid: string;
  name: string;
  photoUrl: string | null;
}): Promise<void> => admin.appointModerator(api, who);

export const removeModerator = (uid: string): Promise<void> => admin.removeModerator(api, uid);

export const findCandidates = (q: string): Promise<{ people: Candidate[] }> =>
  admin.findCandidates(api, q);

export const loadAdminCounts = (): Promise<{ reports: number; proposals: number }> =>
  admin.loadAdminCounts(api);

export const loadAnonymousLists = (
  after: string | null = null,
): Promise<{ lists: AnonymousList[]; nextCursor: string | null }> =>
  admin.loadAnonymousLists(api, after);

export const loadAdminLists = (
  query: AdminListsQuery,
): Promise<{ lists: AdminList[]; nextCursor: string | null }> => admin.loadAdminLists(api, query);

export const moveList = (id: string, to: ListMove): Promise<void> => admin.moveList(api, id, to);

export const loadHouseLists = (
  after: string | null = null,
): Promise<{ lists: ListSummary[]; nextCursor: string | null }> => admin.loadHouseLists(api, after);

export const publishAsHouse = (request: PublishRequest): Promise<HouseAnswer> =>
  admin.publishAsHouse(api, request);

export const replaceHouseList = (id: string, request: PublishRequest): Promise<HouseAnswer> =>
  admin.replaceHouseList(api, id, request);

export const takeDownHouseList = (id: string): Promise<void> => admin.takeDownHouseList(api, id);
