import type { ApiClient } from "./client";

/** A colour for each theme. */
export interface ThemePair {
  light: string;
  dark: string;
}

export type SectionStatus = "approved" | "pending" | "declined" | "merged";

/**
 * A section as the backend counts it: how many lists it holds, how many came
 * this week, who follows it, and the pictures its header collage may wear
 * (four or none; the backend leaves it empty rather than half a collage).
 *
 * The rest is optional because sections are becoming data rather than nine
 * fixed ones (docs/sections-api.md in the app's repository): until the
 * backend sends a section's name, colours and icon, the site draws the nine
 * it knows from its own table.
 */
export interface SectionStats {
  id: string;
  listCount: number;
  followerCount: number;
  newThisWeek: number;
  collage: string[];
  following: boolean;
  name?: string;
  names?: Partial<Record<string, string>>;
  icon?: string;
  pictureUrl?: string | null;
  tint?: ThemePair;
  topicBg?: ThemePair;
  topicIcon?: ThemePair;
  status?: SectionStatus;
  builtIn?: boolean;
  hidden?: boolean;
  rank?: number | null;
  approvedAt?: number;
  lists30d?: number;
  fileUnder?: string | null;
  /** Who proposed it: sent only to the proposer and to moderators. */
  proposerUid?: string | null;
  /**
   * Why a moderator said no, on one's own declined proposal: sent to its
   * proposer until they dismiss the notice of it.
   */
  declineNote?: string | null;
  /** The section a merged proposal went into, sent the same way. */
  mergedInto?: string | null;
}

export function loadSections(client: ApiClient): Promise<{ sections: SectionStats[] }> {
  return client.request<{ sections: SectionStats[] }>("GET", "/lists/sections");
}

/**
 * One section by its id, also one no tile shows: hidden, or not among the
 * sections yet. 404 when there is none; 410 MERGED {mergedInto} when it went
 * into another, to everybody once it had been approved, with {mergedTopicId}
 * when it became a topic there.
 */
export function loadSection(client: ApiClient, id: string): Promise<SectionStats> {
  return client.request<SectionStats>("GET", `/lists/sections/${encodeURIComponent(id)}`);
}

export function followSection(client: ApiClient, id: string): Promise<{ following: true }> {
  return client.request<{ following: true }>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/follow`,
  );
}

export function unfollowSection(client: ApiClient, id: string): Promise<{ following: false }> {
  return client.request<{ following: false }>(
    "DELETE",
    `/lists/sections/${encodeURIComponent(id)}/follow`,
  );
}

/**
 * A section somebody asks for. The picture is a 16:10 crop at least 960 wide,
 * uploaded first to the proposer's own folder; their lists wait in
 * `fileUnder` until a moderator decides.
 */
export interface SectionProposal {
  name: string;
  icon: string;
  pictureId: string;
  fileUnder: string;
}

/**
 * 201 with the waiting section. Refused with 400 BAD_NAME, NAME_TAKEN {id},
 * BAD_ICON, BAD_FILE_UNDER, BAD_PICTURE {why} or TOO_MANY_PENDING, and with
 * 403 for a guest or a banned account.
 */
/** How much room the signed-in person has left to propose sections, asked before a picture goes up. */
export interface ProposalRoom {
  pending: number;
  maxPending: number;
  proposalsToday: number;
  maxPerDay: number;
  /** Why a proposal sent now would be refused, or null when it would not. */
  refusal: "TOO_MANY_PENDING" | "TOO_MANY_PROPOSALS" | null;
}

/** 403 NOT_SIGNED_IN for a guest. */
export function loadProposalRoom(client: ApiClient): Promise<ProposalRoom> {
  return client.request<ProposalRoom>("GET", "/lists/sections/proposals");
}

export function proposeSection(
  client: ApiClient,
  proposal: SectionProposal,
): Promise<SectionStats> {
  return client.request<SectionStats>("POST", "/lists/sections/proposals", { body: proposal });
}

/**
 * What a withdrawal came to: taken back while it waited, or put away after a
 * moderator had declined or merged it. Null from a backend that answers 204.
 */
export interface Withdrawal {
  outcome: "withdrawn" | "dismissed";
  status: "declined" | "merged";
}

/**
 * The proposer takes a waiting proposal back; its lists stay where they were
 * filed. 409 SETTLED, with its status, when it was approved meanwhile.
 */
export async function withdrawSectionProposal(
  client: ApiClient,
  id: string,
): Promise<Withdrawal | null> {
  const answer = await client.request<Partial<Withdrawal> | undefined>(
    "DELETE",
    `/lists/sections/proposals/${encodeURIComponent(id)}`,
  );
  if (answer === undefined || answer === null) return null;
  const outcome = answer.outcome === "dismissed" ? "dismissed" : "withdrawn";
  return { outcome, status: answer.status === "merged" ? "merged" : "declined" };
}

export type TopicStatus = "pending" | "approved" | "rejected" | "merged";

/** A word of somebody's own inside a section; a new one waits for a moderator. */
export interface Topic {
  id: string;
  name: string;
  section: string | null;
  status: TopicStatus;
  listCount: number;
  followerCount: number;
  following: boolean;
  /** Sent only to staff and to the topic's own creator. */
  createdBy?: string;
  mergedInto: string | null;
  /** Translations by locale; a language left out shows the name as typed. */
  names?: Partial<Record<string, string>>;
  /** Its 16:10 picture, public; null or absent when it has none and wears its section's colours. */
  pictureUrl?: string | null;
}

/** The approved topics of a section, the biggest first. */
export function loadTopics(
  client: ApiClient,
  section: string,
  limit?: number,
): Promise<{ topics: Topic[] }> {
  return client.request<{ topics: Topic[] }>("GET", "/lists/topics", {
    query: { section, limit },
  });
}

/** Pages a moderator reads at most: a backend that never ends its pages cannot keep the page waiting. */
const TOPIC_PAGES_MAX = 100;

/**
 * Every approved topic of a section, page by page: the backend answers at
 * most 50 at a time, most lists first, so the empty ones a moderator may
 * delete come last.
 */
export async function loadAllTopics(
  client: ApiClient,
  section: string,
): Promise<{ topics: Topic[] }> {
  const topics: Topic[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < TOPIC_PAGES_MAX; page++) {
    const answer = await client.request<{ topics: Topic[]; nextCursor?: string | null }>(
      "GET",
      "/lists/topics",
      { query: { section, limit: 50, cursor } },
    );
    for (const topic of answer.topics) {
      if (seen.has(topic.id)) continue;
      seen.add(topic.id);
      topics.push(topic);
    }
    const next = answer.nextCursor ?? null;
    if (next === null || next === cursor) break;
    cursor = next;
  }
  return { topics };
}

/** Approved topics whose name starts with what was typed, in one section if given. */
export function findTopics(
  client: ApiClient,
  q: string,
  section?: string,
): Promise<{ topics: Topic[] }> {
  return client.request<{ topics: Topic[] }>("GET", "/lists/topics", {
    query: { q, section },
  });
}

/** Everything this person proposed, whatever became of it: the waiting ones first. */
export function loadMyTopics(client: ApiClient): Promise<{ topics: Topic[] }> {
  return client.request<{ topics: Topic[] }>("GET", "/lists/topics/mine");
}

/**
 * One topic by its id, whatever became of it: 404 when there is none. A
 * merged one names the topic it went into.
 */
export function loadTopic(client: ApiClient, id: string): Promise<Topic> {
  return client.request<Topic>("GET", `/lists/topics/${encodeURIComponent(id)}`);
}

export function followTopic(client: ApiClient, id: string): Promise<{ following: true }> {
  return client.request<{ following: true }>(
    "POST",
    `/lists/topics/${encodeURIComponent(id)}/follow`,
  );
}

export function unfollowTopic(client: ApiClient, id: string): Promise<{ following: false }> {
  return client.request<{ following: false }>(
    "DELETE",
    `/lists/topics/${encodeURIComponent(id)}/follow`,
  );
}
