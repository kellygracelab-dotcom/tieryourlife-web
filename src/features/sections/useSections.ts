import { useEffect, useSyncExternalStore } from "react";
import type { SectionStats } from "../../api/sections";
import { useSession } from "../../app/session";
import { followSection, loadSections, unfollowSection } from "../../lib/api";
import { remembered, type Remembered } from "../../lib/remembered";
import { localStorageStore } from "../../lib/storage";
import { orderSections, sectionsFrom, type Section } from "./model";

/** Counts change slowly; the backend itself keeps them ten minutes. */
export const SECTIONS_FRESH_MS = 10 * 60 * 1000;

export interface SectionsDeps {
  load: () => Promise<{ sections: SectionStats[] }>;
  follow: (id: string) => Promise<unknown>;
  unfollow: (id: string) => Promise<unknown>;
  now: () => number;
  /** The last answer on this device, to open with: left out, nothing is kept. */
  memory?: Remembered<KeptSections>;
}

/** The backend's last answer, and for whom: what one follows is part of it. */
export interface KeptSections {
  sections: SectionStats[];
  who: string;
}

export interface SectionsSnapshot {
  /** Never empty: the nine stand in until the backend has answered. */
  sections: Section[];
  /** Whether what is shown came from the backend. */
  loaded: boolean;
  /**
   * Whether what is shown is the backend's, now or as last read on this
   * device. Until then the nine stand in only to be counted: a page draws
   * their places, not their art, or it would flash and reorder.
   */
  known: boolean;
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
  const kept = deps.memory?.recall("sections") ?? null;
  let snapshot: SectionsSnapshot =
    kept === null
      ? { sections: sectionsFrom(null), loaded: false, known: false, failed: false }
      : {
          sections: orderSections(sectionsFrom(kept.sections, kept.who)),
          loaded: false,
          known: true,
          failed: false,
        };
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
          if (who !== null) deps.memory?.keep("sections", { sections: sections ?? [], who });
          set({
            sections: orderSections(sectionsFrom(sections ?? [], who)),
            loaded: true,
            known: true,
            failed: false,
          });
          again();
        },
        () => {
          // The nine, then, drawn as they are: nothing better is coming.
          set({ ...snapshot, known: true, failed: true });
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
  memory: remembered(localStorageStore, "tyl:sections", 1),
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
