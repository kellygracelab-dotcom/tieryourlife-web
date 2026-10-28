import type { ApiClient } from "./client";
import type { Category } from "./types";

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
}

export function loadSections(client: ApiClient): Promise<{ sections: SectionStats[] }> {
  return client.request<{ sections: SectionStats[] }>("GET", "/lists/sections");
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
export function proposeSection(
  client: ApiClient,
  proposal: SectionProposal,
): Promise<SectionStats> {
  return client.request<SectionStats>("POST", "/lists/sections/proposals", { body: proposal });
}

/** The proposer takes a waiting proposal back; its lists stay where they were filed. */
export function withdrawSectionProposal(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/sections/proposals/${encodeURIComponent(id)}`);
}

export type TopicStatus = "pending" | "approved" | "rejected" | "merged";

/** A word of somebody's own inside a section; a new one waits for a moderator. */
export interface Topic {
  id: string;
  name: string;
  section: Category | null;
  status: TopicStatus;
  listCount: number;
  followerCount: number;
  following: boolean;
  createdBy: string;
  mergedInto: string | null;
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

/** Everything this person proposed, whatever became of it: the waiting ones first. */
export function loadMyTopics(client: ApiClient): Promise<{ topics: Topic[] }> {
  return client.request<{ topics: Topic[] }>("GET", "/lists/topics/mine");
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
