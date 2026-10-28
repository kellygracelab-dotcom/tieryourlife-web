import type { ApiClient } from "./client";
import type { Category } from "./types";

/**
 * A section as the backend counts it: how many lists it holds, how many came
 * this week, who follows it, and the pictures its header collage may wear
 * (four or none; the backend leaves it empty rather than half a collage).
 */
export interface SectionStats {
  id: Category;
  listCount: number;
  followerCount: number;
  newThisWeek: number;
  collage: string[];
  following: boolean;
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
  section: Category,
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
