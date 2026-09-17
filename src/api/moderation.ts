import type { ApiClient } from "./client";
import type { ReportReason } from "./community";

/** How long a ban can be, in the moderator's words; null bans nobody. */
export const BAN_LENGTHS = ["week", "month", "three_months", "six_months", "forever"] as const;
export type BanLength = (typeof BAN_LENGTHS)[number];

/** One list in the queue, with everything said about it. Newest first. */
export interface QueuedList {
  listId: string;
  listTitle: string;
  authorName: string;
  authorUid: string | null;
  authorPhotoUrl: string | null;
  coverImageUrl: string | null;
  reasons: ReportReason[];
  notes: string[];
  reportCount: number;
  newestAtMs: number;
  /** Out of the feed while it waits to be looked at. */
  hidden: boolean;
  /** Looked at once and kept, so later complaints no longer hide it. */
  reviewed: boolean;
}

/** The queue; 403 NOT_YOURS for anyone but the moderator. */
export function getReports(client: ApiClient): Promise<{ reports: QueuedList[] }> {
  return client.request<{ reports: QueuedList[] }>("GET", "/lists/reports");
}

/** Takes the list down for good and, when asked, bans its author. */
export function takeDown(client: ApiClient, id: string, ban: BanLength | null): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/takedown`, {
    body: { ban },
  });
}

/** Leaves the list up; its complaints are answered and no longer hide it. */
export function dismissReports(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/dismiss`);
}
