import { createContext, useContext } from "react";
import type { Following } from "../api/community";
import type { PublishedList } from "../api/types";
import type { FeedState, RememberedPage } from "../features/feed/useFeed";

/** Transient snapshots owned by one signed-in session. Never written to browser storage. */
export class VisitMemory {
  lists = new Map<string, PublishedList>();
  follows = new Map<string, Following>();
  feed: Extract<FeedState, { status: "ready" }> | null = null;
  further = new Map<string, RememberedPage>();
  clear() {
    this.lists.clear();
    this.follows.clear();
    this.feed = null;
    this.further.clear();
  }
}
export const VisitContext = createContext<VisitMemory | null>(null);
export const useVisit = () => useContext(VisitContext);
