import type { ApiClient } from "./client";
import { summaryOf, type PublishRequest } from "./lists";
import type { SectionStats, ThemePair, Topic } from "./sections";
import type { FeedSort, ListSummary } from "./types";

/**
 * What the admin page asks of the backend. Every call is checked there: the
 * owner (the configured address) may do everything, an appointed moderator
 * the queues and topics (docs/sections-api.md in the app's repository). The
 * page only hides what the backend would refuse anyway.
 */
export type AdminRole = "owner" | "moderator";

/** The sections as an admin reads them: hidden, waiting and merged ones too, and who is asking. */
export interface AdminSections {
  sections: SectionStats[];
  role?: AdminRole | null;
  /** The order's version: a Save made against an older one is refused. Null for anybody not staff. */
  version?: number | null;
}

export function loadAdminSections(client: ApiClient): Promise<AdminSections> {
  return client.request<AdminSections>("GET", "/lists/sections");
}

/** The whole order and what is hidden, in one write; 409 CONFLICT when somebody saved in between. */
export function saveSectionOrder(
  client: ApiClient,
  ids: string[],
  hidden: string[],
  version: number | undefined,
): Promise<{ version: number }> {
  return client.request<{ version: number }>("PUT", "/lists/sections/order", {
    body: { ids, hidden, version },
  });
}

/** What a section is made of when it is created or changed by hand. */
export interface SectionDraft {
  name: string;
  /** Translations by locale; a language left out shows the name as typed. */
  names?: Record<string, string>;
  icon: string;
  /** A picture already uploaded to the person's own folder. */
  pictureId?: string | null;
  /** A colour picked from the picture, expanded by the backend into all five. */
  tint?: string;
  /** A pinned place in the order; left out, the backend's order places it. */
  rank?: number | null;
}

/** What an edit may change: any of a draft's fields, and whether the section is hidden. */
export type SectionChanges = Partial<SectionDraft> & { hidden?: boolean };

export function createSection(client: ApiClient, draft: SectionDraft): Promise<SectionStats> {
  return client.request<SectionStats>("POST", "/lists/sections", { body: draft });
}

/** Only what is named changes; a built-in refuses a picture with 409 BUILT_IN. */
export function editSection(
  client: ApiClient,
  id: string,
  draft: SectionChanges,
): Promise<SectionStats> {
  return client.request<SectionStats>("PATCH", `/lists/sections/${encodeURIComponent(id)}`, {
    body: draft,
  });
}

/** Only an empty section can go; 409 NOT_EMPTY otherwise, and a built-in never. */
export function deleteSection(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/sections/${encodeURIComponent(id)}`);
}

/**
 * What a waiting proposal's name is already taken by, as staff see it: an
 * approved topic (with the section it is in), or a section. A topic wins
 * when both are; translations are not compared.
 */
export type NameClash =
  | { kind: "topic"; id: string; name: string; section: string | null; sectionName: string | null }
  | { kind: "section"; id: string; name: string };

/** A section somebody proposed, as the queue shows it. */
export interface ProposedSection extends SectionStats {
  proposerUid?: string | null;
  proposerName?: string;
  createdAt?: number;
  /** How many of the proposer's lists wait in fileUnder for it. */
  waitingLists?: number;
  /** The picture's five strongest colours, to pick another tint from. */
  palette?: string[];
  tint?: ThemePair;
  /** Null when the name is free; left out by a backend from before it said. */
  nameClash?: NameClash | null;
  /**
   * A decision made but cut short, its lists not all moved: it comes after
   * the waiting ones, with the call that finishes it.
   */
  unfinished?: boolean;
  finish?: FinishCall;
}

/** The decisions a stuck one can be finished by, each the call it was made with. */
export const FINISH_ACTIONS = [
  "approve",
  "decline",
  "merge",
  "approve-as-topic",
  "merge-into-topic",
] as const;

export interface FinishCall {
  action: (typeof FINISH_ACTIONS)[number];
  body: Record<string, unknown>;
}

/** The same call again, with the same body, which the backend resumes from where it stopped. */
export function finishDecision(
  client: ApiClient,
  id: string,
  finish: FinishCall,
): Promise<unknown> {
  if (!FINISH_ACTIONS.includes(finish.action)) {
    return Promise.reject(new Error(`Not a decision: ${String(finish.action)}`));
  }
  return client.request<unknown>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/${finish.action}`,
    { body: finish.body },
  );
}

export function loadSectionQueue(client: ApiClient): Promise<{ sections: ProposedSection[] }> {
  return client.request<{ sections: ProposedSection[] }>("GET", "/lists/sections/queue");
}

export function approveSection(
  client: ApiClient,
  id: string,
  changes: Partial<SectionDraft> = {},
): Promise<SectionStats> {
  return client.request<SectionStats>("POST", `/lists/sections/${encodeURIComponent(id)}/approve`, {
    body: changes,
  });
}

export function declineSection(client: ApiClient, id: string, note: string | null): Promise<void> {
  return client.request<void>("POST", `/lists/sections/${encodeURIComponent(id)}/decline`, {
    body: note === null ? {} : { note },
  });
}

export function mergeSection(client: ApiClient, id: string, into: string): Promise<void> {
  return client.request<void>("POST", `/lists/sections/${encodeURIComponent(id)}/merge`, {
    body: { into },
  });
}

/** Where a section proposal goes as a topic: an open section, and the name it takes there. */
export interface TopicApproval {
  section: string;
  name?: string;
  names?: Record<string, string>;
}

/**
 * A proposed section approved as a topic of an open one instead: the topic
 * takes its picture, the proposal is merged into the section, and the lists
 * waiting for it move under the topic. Refused with 409 NAME_TAKEN {id} when
 * a topic has that name (merge into it instead), and 409 SETTLED when it was decided already.
 */
export function approveSectionAsTopic(
  client: ApiClient,
  id: string,
  approval: TopicApproval,
): Promise<{ topic: Topic | null; proposal: SectionStats | null }> {
  return client.request<{ topic: Topic | null; proposal: SectionStats | null }>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/approve-as-topic`,
    { body: approval },
  );
}

/**
 * A proposal merged into an approved topic that has its name: the lists
 * waiting for it move under the topic, which keeps its own picture. Refused
 * with 400 INVALID when the topic cannot take it (not approved, or its
 * section hidden) and 409 SETTLED when it was decided already.
 */
export function mergeSectionIntoTopic(
  client: ApiClient,
  id: string,
  topic: string,
): Promise<{ topic: Topic | null; proposal: SectionStats | null }> {
  return client.request<{ topic: Topic | null; proposal: SectionStats | null }>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/merge-into-topic`,
    { body: { topic } },
  );
}

/**
 * Whether a name is free: the section it clashes with when it is not, or
 * BAD_NAME for one no section could have.
 */
export interface NameCheck {
  free: boolean;
  id?: string;
  code?: string;
}

/** Whether a name is free, asked while it is typed: the same rule as the backend's uniqueness. */
export function checkSectionName(client: ApiClient, name: string): Promise<NameCheck> {
  return client.request<NameCheck>("GET", "/lists/sections/name-check", {
    query: { name },
  });
}

/** A proposed topic in the queue: who asked, where, and the approved ones it may be a twin of. */
export interface PendingTopic extends Topic {
  proposerName?: string;
  requestedSection?: string | null;
  similar?: Topic[];
}

export function loadTopicQueue(client: ApiClient): Promise<{ topics: PendingTopic[] }> {
  return client.request<{ topics: PendingTopic[] }>("GET", "/lists/topics/pending");
}

export type TopicDecision =
  | { action: "approve"; section: string }
  | { action: "reject" }
  | { action: "rename"; name: string }
  | { action: "merge"; into: string };

export function decideTopic(client: ApiClient, id: string, decision: TopicDecision): Promise<void> {
  const { action, ...body } = decision;
  return client.request<void>("POST", `/lists/topics/${encodeURIComponent(id)}/${action}`, {
    body,
  });
}

/** What a topic is made of when staff make one by hand. */
export interface TopicDraft {
  name: string;
  section: string;
  names?: Record<string, string>;
  /** A 16:10 picture already uploaded to the person's own folder. */
  pictureId?: string;
}

/**
 * What an edit of a topic may change. A picture id replaces its picture,
 * null takes it away, and left out it stays as it is.
 */
export interface TopicChanges {
  name?: string;
  names?: Record<string, string>;
  pictureId?: string | null;
}

/**
 * An approved topic made by hand, without waiting in the queue. Refused with
 * 409 NAME_TAKEN {id} and 400 BAD_PICTURE {why}, as a section's picture is.
 */
export function createTopic(client: ApiClient, draft: TopicDraft): Promise<Topic> {
  return client.request<Topic>("POST", "/lists/topics", { body: draft });
}

export function editTopic(client: ApiClient, id: string, draft: TopicChanges): Promise<Topic> {
  return client.request<Topic>("PATCH", `/lists/topics/${encodeURIComponent(id)}`, { body: draft });
}

export function deleteTopic(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/topics/${encodeURIComponent(id)}`);
}

export interface Moderator {
  uid: string;
  name: string;
  photoUrl: string | null;
  email?: string;
  appointedAt: number;
}

export function loadModerators(client: ApiClient): Promise<{ moderators: Moderator[] }> {
  return client.request<{ moderators: Moderator[] }>("GET", "/lists/moderators");
}

export function appointModerator(
  client: ApiClient,
  who: { uid: string; name: string; photoUrl: string | null },
): Promise<void> {
  return client.request<void>("POST", `/lists/moderators/${encodeURIComponent(who.uid)}`, {
    body: { name: who.name, photoUrl: who.photoUrl },
  });
}

export function removeModerator(client: ApiClient, uid: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/moderators/${encodeURIComponent(uid)}`);
}

/** Somebody signed in who could be appointed, found by the start of their name or address. */
export interface Candidate {
  uid: string;
  name: string;
  email: string;
  photoUrl: string | null;
}

export function findCandidates(client: ApiClient, q: string): Promise<{ people: Candidate[] }> {
  return client.request<{ people: Candidate[] }>("GET", "/lists/moderators/candidates", {
    query: { q },
  });
}

/** How much waits for an admin: open reports and proposals. */
export function loadAdminCounts(
  client: ApiClient,
): Promise<{ reports: number; proposals: number }> {
  return client.request<{ reports: number; proposals: number }>("GET", "/lists/admin/counts");
}

/** A list published with no author, as the owner sees it: who it came from, kept from everybody else. */
export interface AnonymousList extends ListSummary {
  publishedBy: { uid: string; name: string };
}

/** The anonymous lists, newest first, twenty a page; 409 CURSOR_GONE when the cursor's list went. */
export function loadAnonymousLists(
  client: ApiClient,
  after: string | null = null,
): Promise<{ lists: AnonymousList[]; nextCursor: string | null }> {
  return client.request<{ lists: AnonymousList[]; nextCursor: string | null }>(
    "GET",
    "/lists/anonymous",
    { query: { after: after ?? undefined } },
  );
}

/**
 * A published list as staff see it: under review or not, and who published
 * it, anonymous ones too. Whether it waits for a proposed section the
 * backend may say; when it does not, nobody knows here.
 */
export interface AdminList extends ListSummary {
  underReview: boolean;
  /** Null on a list without its author's name, for anybody but the owner. */
  publishedBy: { uid: string; name: string } | null;
  proposedSection?: string | null;
  proposedSectionName?: string | null;
}

/**
 * Which lists of a section: those of one topic, those without one (`none`),
 * those whose topic is not an approved one of this section (`other`), or all.
 */
export interface AdminListsQuery {
  section: string;
  topic?: string;
  sort?: FeedSort;
  after?: string | null;
}

/** One section's lists, twenty a page; 409 CURSOR_GONE when the cursor's list went. */
export function loadAdminLists(
  client: ApiClient,
  query: AdminListsQuery,
): Promise<{ lists: AdminList[]; nextCursor: string | null }> {
  return client.request<{ lists: AdminList[]; nextCursor: string | null }>(
    "GET",
    "/lists/admin/lists",
    {
      query: {
        section: query.section,
        topic: query.topic,
        sort: query.sort,
        after: query.after ?? undefined,
      },
    },
  );
}

/**
 * Where a list is moved: into an approved topic, whose section it takes, or
 * into a section without a topic. A list waiting for a proposed section stops
 * waiting.
 */
export type ListMove = { topicId: string } | { category: string; topicId: null };

export function moveList(client: ApiClient, id: string, to: ListMove): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/move`, { body: to });
}

/** Where a house list went out, or what replaced it. */
export interface HouseAnswer {
  id: string;
  topicId: string | null;
}

/**
 * A board published as the house: no name, no face, no account behind it,
 * an ordinary anonymous list to everybody, staff too. The owner and the
 * moderators may; anybody else gets 403 NOT_YOURS. The body is a publish's, whose
 * `anonymous` is ignored here, and it is refused the way a publish is.
 */
export function publishAsHouse(client: ApiClient, request: PublishRequest): Promise<HouseAnswer> {
  return client.request<HouseAnswer>("POST", "/lists/editorial", { body: request });
}

/** A house list replaced in place, same id and link; 403 NOT_YOURS when it is not the house's. */
export function replaceHouseList(
  client: ApiClient,
  id: string,
  request: PublishRequest,
): Promise<HouseAnswer> {
  return client.request<HouseAnswer>("PUT", `/lists/editorial/${encodeURIComponent(id)}`, {
    body: request,
  });
}

/** Takes a house list down; 204 when it was gone already, too. */
export function takeDownHouseList(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/editorial/${encodeURIComponent(id)}`);
}

/**
 * The house's lists, the latest changed first, a page at a time; 409
 * CURSOR_GONE when the cursor's list went. Their covers are tidied the way
 * the feed's are, since they come from the same snapshots.
 */
export async function loadHouseLists(
  client: ApiClient,
  after: string | null = null,
): Promise<{ lists: ListSummary[]; nextCursor: string | null }> {
  const page = await client.request<{ lists?: ListSummary[]; nextCursor?: string | null }>(
    "GET",
    "/lists/editorial",
    { query: { after: after ?? undefined } },
  );
  return { lists: (page.lists ?? []).map(summaryOf), nextCursor: page.nextCursor ?? null };
}
