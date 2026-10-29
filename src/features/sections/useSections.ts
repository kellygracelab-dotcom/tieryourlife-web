import { useEffect, useSyncExternalStore } from "react";
import type { SectionStats } from "../../api/sections";
import { useSession } from "../../app/session";
import { followSection, loadSections, unfollowSection } from "../../lib/api";
import { orderSections, sectionsFrom, type Section } from "./model";

/** Counts change slowly; the backend itself keeps them ten minutes. */
export const SECTIONS_FRESH_MS = 10 * 60 * 1000;

export interface SectionsDeps {
  load: () => Promise<{ sections: SectionStats[] }>;
  follow: (id: string) => Promise<unknown>;
  unfollow: (id: string) => Promise<unknown>;
  now: () => number;
}

export interface SectionsSnapshot {
  /** Never empty: the nine stand in until the backend has answered. */
  sections: Section[];
  /** Whether what is shown came from the backend. */
  loaded: boolean;
  failed: boolean;
}

export interface SectionsStore {
  get: () => SectionsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /**
   * Asks the backend again unless the answer is still fresh and was given to
   * the same person: what one follows is part of the answer.
   */
  refresh: (who: string | null) => void;
  /** Follows or unfollows at once; the tile moves now and comes back if the backend says no. */
  setFollowing: (id: string, following: boolean) => Promise<boolean>;
  /** Forgets the answer, so the next page that shows sections asks again: after an admin's Save. */
  invalidate: () => void;
}

/**
 * One copy of the sections for the whole site: the front page, the section
 * pages and the Following tab read the same counts, and a follow made on one
 * shows on the others without asking the backend again.
 */
export function createSectionsStore(deps: SectionsDeps): SectionsStore {
  let snapshot: SectionsSnapshot = { sections: sectionsFrom(null), loaded: false, failed: false };
  let loadedAt: number | null = null;
  let loadedFor: string | null = null;
  let wanted: string | null = null;
  let loading = false;
  const listeners = new Set<() => void>();

  const set = (next: SectionsSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const withFollowing = (id: string, following: boolean) =>
    orderSections(
      snapshot.sections.map((section) =>
        section.id === id && section.following !== following
          ? {
              ...section,
              following,
              followerCount: Math.max(0, section.followerCount + (following ? 1 : -1)),
            }
          : section,
      ),
    );

  const store: SectionsStore = {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh(who) {
      wanted = who;
      if (loading) return;
      const fresh = loadedAt !== null && deps.now() - loadedAt < SECTIONS_FRESH_MS;
      if (fresh && loadedFor === who) return;
      loading = true;
      // Somebody who signs in while the answer is on its way is asked for again.
      const again = () => {
        loading = false;
        if (wanted !== who) store.refresh(wanted);
      };
      deps.load().then(
        ({ sections }) => {
          loadedAt = deps.now();
          loadedFor = who;
          set({
            sections: orderSections(sectionsFrom(sections ?? [], who)),
            loaded: true,
            failed: false,
          });
          again();
        },
        () => {
          set({ ...snapshot, failed: true });
          again();
        },
      );
    },
    invalidate() {
      loadedAt = null;
    },
    async setFollowing(id, following) {
      const before = snapshot.sections;
      set({ ...snapshot, sections: withFollowing(id, following) });
      try {
        await (following ? deps.follow(id) : deps.unfollow(id));
        return true;
      } catch {
        set({ ...snapshot, sections: before });
        return false;
      }
    },
  };
  return store;
}

export const sectionsStore = createSectionsStore({
  load: loadSections,
  follow: followSection,
  unfollow: unfollowSection,
  now: Date.now,
});

/** The sections in the app's order, asked for once the page that shows them opens. */
export function useSections(store: SectionsStore = sectionsStore): SectionsSnapshot {
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { account } = useSession();
  // Until the session is known nobody is asked for: the backend needs a token.
  const who = account === null ? null : account.kind === "signedIn" ? account.uid : "guest";
  useEffect(() => {
    if (who !== null) store.refresh(who);
  }, [store, who]);
  return snapshot;
}
