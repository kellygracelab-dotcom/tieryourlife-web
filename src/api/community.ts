import type { ApiClient } from "./client";

/**
 * The proxy's reasons, in the order the app's report sheet shows them. The
 * last one never hides a list: a list in the wrong place is moved, not hidden.
 */
export const REPORT_REASONS = [
  "sexual",
  "violence",
  "hate",
  "spam",
  "other",
  "wrong_category",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A note longer than this is cut by the backend anyway. */
export const REPORT_NOTE_MAX = 500;

export interface ReportRequest {
  reason: ReportReason;
  note: string | null;
}

/** One complaint per person per list; the backend answers 204 either way. */
export function report(client: ApiClient, id: string, request: ReportRequest): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/report`, {
    body: request,
  });
}

export interface FollowState {
  following: boolean;
  followers: number;
}

export function followState(client: ApiClient, authorUid: string): Promise<FollowState> {
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
export function suggestedAuthors(client: ApiClient): Promise<{ authors: SuggestedAuthor[] }> {
  return client.request<{ authors: SuggestedAuthor[] }>("GET", "/lists/follow");
}

/** Somebody this person follows, with the name and face their newest list carries. */
export interface FollowedAuthor {
  uid: string;
  name: string;
  photoUrl: string | null;
}

/** Whom this person follows; the backend answers `topics` too, which the site leaves alone. */
export function loadFollowing(client: ApiClient): Promise<{ authors: FollowedAuthor[] }> {
  return client.request<{ authors: FollowedAuthor[] }>("GET", "/lists/following");
}

/**
 * One of the person's own uploaded pictures becomes their face: the backend
 * checks it and keeps a copy where everybody may see it. 422 PICTURE_REFUSED
 * when the picture cannot be a face.
 */
export function makeFace(client: ApiClient, pictureId: string): Promise<{ url: string }> {
  return client.request<{ url: string }>("POST", `/lists/face/${encodeURIComponent(pictureId)}`);
}
