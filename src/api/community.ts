import type { ApiClient } from "./client";

/** The proxy's five reasons, in the order the app shows them. */
export const REPORT_REASONS = ["sexual", "hate", "violence", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A note longer than this is cut by the backend anyway. */
export const REPORT_NOTE_MAX = 500;

export interface ReportRequest {
  reason: ReportReason;
  note: string | null;
}

/** One complaint per person per list; the backend answers 204 either way. */
export function reportList(client: ApiClient, id: string, request: ReportRequest): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/report`, {
    body: request,
  });
}

export interface FollowState {
  following: boolean;
  followers: number;
}

export function getFollowState(client: ApiClient, authorUid: string): Promise<FollowState> {
  return client.request<FollowState>("GET", `/lists/follow/${encodeURIComponent(authorUid)}`);
}

export function followAuthor(client: ApiClient, authorUid: string): Promise<{ following: true }> {
  return client.request<{ following: true }>(
    "POST",
    `/lists/follow/${encodeURIComponent(authorUid)}`,
  );
}

export function unfollowAuthor(
  client: ApiClient,
  authorUid: string,
): Promise<{ following: false }> {
  return client.request<{ following: false }>(
    "DELETE",
    `/lists/follow/${encodeURIComponent(authorUid)}`,
  );
}

export interface SuggestedAuthor {
  uid: string;
  name: string;
  photoUrl: string | null;
  takeCount: number;
}

/** Authors worth following, by how often their lists are taken; never oneself or anyone followed. */
export function getSuggestedAuthors(client: ApiClient): Promise<{ authors: SuggestedAuthor[] }> {
  return client.request<{ authors: SuggestedAuthor[] }>("GET", "/lists/follow");
}
