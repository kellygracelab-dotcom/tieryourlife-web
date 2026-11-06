import { useEffect, useSyncExternalStore } from "react";
import { errorOf, type ApiError } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import { useSession } from "../../app/session";
import {
  followSection,
  loadSection,
  loadSections,
  unfollowSection,
  withdrawSectionProposal,
} from "../../lib/api";
import { remembered, type Remembered } from "../../lib/remembered";
import { localStorageStore } from "../../lib/storage";
import {
  orderSections,
  proposalHomesFrom,
  proposalNoticesFrom,
  sectionOf,
  sectionsFrom,
  type ProposalNotice,
  type Section,
} from "./model";

/** Counts change slowly; the backend itself keeps them ten minutes. */
export const SECTIONS_FRESH_MS = 10 * 60 * 1000;

export interface SectionsDeps {
  load: () => Promise<{ sections: SectionStats[] }>;
  follow: (id: string) => Promise<unknown>;
  unfollow: (id: string) => Promise<unknown>;
  /** One section by its id, for one followed that the list leaves out; left out, none is asked about. */
  loadOne?: (id: string) => Promise<SectionStats>;
  /** Dismisses the notice of one's own declined or merged proposal. */
  dismiss?: (id: string) => Promise<unknown>;
  now: () => number;
  /** The last answer on this device, to open with: left out, nothing is kept. */
  memory?: Remembered<KeptSections>;
}

/** The backend's last answer, and for whom: what one follows is part of it. */
export interface KeptSections {
  sections: SectionStats[];
  who: string;
  /** Where the person's own proposals keep their lists, past the answers that named them. */
  homes?: Record<string, string>;
}

/**
 * A kept answer this site can draw, or nothing: one kept by another version
 * of the site, or changed by hand, is dropped rather than failing every page.
 */
export function readKeptSections(kept: unknown): KeptSections | null {
  if (typeof kept !== "object" || kept === null) return null;
  const { sections, who, homes } = kept as Partial<Record<keyof KeptSections, unknown>>;
  if (!Array.isArray(sections) || typeof who !== "string") return null;
  if (!sections.every((one) => typeof one === "object" && one !== null && "id" in one)) return null;
  const answer = sections as SectionStats[];
  sectionsFrom(answer, who); // throws for anything it cannot draw
  // Homes that are not all names are dropped on their own: the answer is still good.
  const named =
    typeof homes === "object" &&
    homes !== null &&
    Object.values(homes).every((home) => typeof home === "string");
  return { sections: answer, who, ...(named ? { homes: homes as Record<string, string> } : {}) };
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
  /**
   * Sections asked about by their id because the list leaves them out: a
   * hidden one, or one approved since it was read. Never drawn as tiles, but
   * followed and unfollowed like the others, as the app's catalogue keeps them.
   */
  extra: Section[];
  /**
   * Whether the sections' Follow marks are the backend's word for this
   * person, now or as last read here: the nine standing in know nothing of it.
   */
  followsKnown: boolean;
  /** What became of one's own proposals a moderator did not approve, until dismissed. */
  notices: ProposalNotice[];
  /**
   * Where one's own proposals keep their lists, by id, kept after they leave
   * the answer: a board filed under one withdrawn names where its list is.
   */
  homes: Readonly<Record<string, string>>;
}

/** A section the store holds, among the sections or those asked about by id. */
export const heldSection = (snapshot: SectionsSnapshot, id: string): Section | undefined =>
  snapshot.sections.find((one) => one.id === id) ?? snapshot.extra.find((one) => one.id === id);

export interface SectionsStore {
  get: () => SectionsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /**
   * Asks the backend again unless the answer is still fresh and was given to
   * the same person: what one follows is part of the answer.
   */
  refresh: (who: string | null) => void;
  /**
   * Follows or unfollows at once; the tile moves now and comes back if the
   * backend says no. Null when it was done, or what the backend said instead.
   */
  setFollowing: (id: string, following: boolean) => Promise<ApiError | null>;
  /** Forgets the answer, so the next page that shows sections asks again: after an admin's Save. */
  invalidate: () => void;
  /** Holds a section asked about by its id, which the list leaves out. */
  keep: (stats: SectionStats) => void;
  /** Asks once about a followed section the store does not hold, and holds it. */
  lookUp: (id: string) => void;
  /** Takes a notice away at once; it comes back if the backend says no. */
  dismissNotice: (id: string) => Promise<boolean>;
  /** Takes in the follows another tab kept on this device for the same person. */
  adoptKept: () => void;
}

/**
 * One copy of the sections for the whole site: the front page, the section
 * pages and the Following tab read the same counts, and a follow made on one
 * shows on the others without asking the backend again.
 */
export function createSectionsStore(deps: SectionsDeps): SectionsStore {
  let kept = deps.memory?.recall("sections") ?? null;
  let snapshot: SectionsSnapshot =
    kept === null
      ? {
          sections: sectionsFrom(null),
          loaded: false,
          known: false,
          failed: false,
          extra: [],
          followsKnown: false,
          notices: [],
          homes: {},
        }
      : {
          sections: orderSections(sectionsFrom(kept.sections, kept.who)),
          loaded: false,
          known: true,
          failed: false,
          extra: [],
          followsKnown: true,
          notices: proposalNoticesFrom(kept.sections, kept.who),
          homes: kept.homes ?? proposalHomesFrom(kept.sections, kept.who, {}),
        };
  // The backend's answer as kept on this device, so a follow made here is kept in it too.
  let lastAnswer: KeptSections | null = kept;
  // Follows made here, by id, that an answer asked for before they landed
  // does not know of yet: it would turn them back on screen. One that had
  // landed before the next question is the backend's own, and goes.
  const made = new Map<string, { following: boolean; landed: boolean }>();
  let loadedAt: number | null = null;
  let loadedFor: string | null = null;
  let wanted: string | null = null;
  let loading = false;
  const askedAbout = new Set<string>();
  const listeners = new Set<() => void>();

  const set = (next: SectionsSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const turned = (sections: readonly Section[], id: string, following: boolean): Section[] =>
    sections.map((section) =>
      section.id === id && section.following !== following
        ? {
            ...section,
            following,
            followerCount: Math.max(0, section.followerCount + (following ? 1 : -1)),
          }
        : section,
    );

  const store: SectionsStore = {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh(who) {
      wanted = who;
      // The answer kept on this device was somebody's: on a shared browser the
      // next person never sees their waiting proposal or what they follow.
      if (kept !== null && loadedFor === null && who !== null && who !== kept.who) {
        const anybodys = kept.sections.map((stats) => ({ ...stats, following: false }));
        set({
          ...snapshot,
          sections: orderSections(sectionsFrom(anybodys, who)),
          followsKnown: false,
          notices: [],
          homes: {},
        });
        kept = null;
      }
      if (loading) return;
      const fresh = loadedAt !== null && deps.now() - loadedAt < SECTIONS_FRESH_MS;
      if (fresh && loadedFor === who) return;
      loading = true;
      made.forEach((one, id) => {
        if (one.landed) made.delete(id);
      });
      // Somebody who signs in while the answer is on its way is asked for again.
      const again = () => {
        loading = false;
        if (wanted !== who) store.refresh(wanted);
      };
      deps.load().then(
        ({ sections: told }) => {
          const sections = (told ?? []).map((stats) => {
            const mine = made.get(stats.id);
            return mine === undefined || mine.following === stats.following
              ? stats
              : {
                  ...stats,
                  following: mine.following,
                  followerCount: Math.max(0, stats.followerCount + (mine.following ? 1 : -1)),
                };
          });
          let shown: Section[];
          try {
            shown = orderSections(sectionsFrom(sections, who));
          } catch {
            // An answer this site cannot read is as good as none, and is not kept.
            set({ ...snapshot, known: true, failed: true });
            again();
            return;
          }
          // What was asked about by id was asked for somebody: another person starts afresh.
          const extra = loadedFor === null || loadedFor === who ? snapshot.extra : [];
          if (extra.length === 0) askedAbout.clear();
          loadedAt = deps.now();
          loadedFor = who;
          // The homes are the person's own: another's start afresh.
          const homes =
            who === null
              ? {}
              : proposalHomesFrom(
                  sections,
                  who,
                  lastAnswer?.who === who ? (lastAnswer.homes ?? {}) : {},
                );
          if (who !== null) {
            lastAnswer = { sections, who, homes };
            deps.memory?.keep("sections", lastAnswer);
          }
          set({
            sections: shown,
            loaded: true,
            known: true,
            failed: false,
            extra,
            followsKnown: true,
            notices: who === null ? [] : proposalNoticesFrom(sections, who),
            homes,
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
      const turn = (on: boolean) =>
        set({
          ...snapshot,
          sections: orderSections(turned(snapshot.sections, id, on)),
          extra: turned(snapshot.extra, id, on),
        });
      const mine = { following, landed: false };
      made.set(id, mine);
      const before = snapshot;
      turn(following);
      const turnedTo = snapshot;
      try {
        await (following ? deps.follow(id) : deps.unfollow(id));
        mine.landed = true;
        // What the page opens with next time, here and in another tab.
        if (lastAnswer !== null && lastAnswer.who === wanted) {
          lastAnswer = {
            ...lastAnswer,
            sections: lastAnswer.sections.map((stats) =>
              stats.id === id ? { ...stats, following } : stats,
            ),
          };
          deps.memory?.keep("sections", lastAnswer);
        }
        return null;
      } catch (reason) {
        if (made.get(id) === mine) made.delete(id);
        // Back where it was, unless the sections changed meanwhile: then only this one turns back.
        if (snapshot === turnedTo) {
          set({ ...snapshot, sections: before.sections, extra: before.extra });
        } else {
          turn(!following);
        }
        return errorOf(reason);
      }
    },
    keep(stats) {
      const section = sectionOf(stats);
      set({
        ...snapshot,
        extra: [...snapshot.extra.filter((one) => one.id !== section.id), section],
      });
    },
    lookUp(id) {
      if (deps.loadOne === undefined || askedAbout.has(id)) return;
      if (heldSection(snapshot, id) !== undefined) return;
      askedAbout.add(id);
      // Nothing is said when it cannot be had: its row keeps the name it has.
      deps.loadOne(id).then(store.keep, () => askedAbout.delete(id));
    },
    async dismissNotice(id) {
      const gone = snapshot.notices.find((one) => one.id === id);
      if (gone === undefined || deps.dismiss === undefined) return false;
      set({ ...snapshot, notices: snapshot.notices.filter((one) => one.id !== id) });
      try {
        await deps.dismiss(id);
        return true;
      } catch {
        set({ ...snapshot, notices: [...snapshot.notices, gone] });
        return false;
      }
    },
    adoptKept() {
      const other = deps.memory?.recall("sections") ?? null;
      if (other === null || other.who !== wanted) return;
      lastAnswer = other;
      let { sections, extra } = snapshot;
      other.sections.forEach(({ id, following }) => {
        // A follow of this tab's own still on its way is the newer word.
        if (made.get(id)?.landed === false) return;
        sections = turned(sections, id, following);
        extra = turned(extra, id, following);
      });
      const same = (now: readonly Section[], was: readonly Section[]) =>
        now.every((one, at) => one === was[at]);
      if (same(sections, snapshot.sections) && same(extra, snapshot.extra)) return;
      set({ ...snapshot, sections: orderSections(sections), extra });
    },
  };
  return store;
}

export const sectionsStore = createSectionsStore({
  load: loadSections,
  follow: followSection,
  unfollow: unfollowSection,
  loadOne: loadSection,
  dismiss: withdrawSectionProposal,
  now: Date.now,
  memory: remembered(localStorageStore, "tyl:sections", 1, readKeptSections),
});

// Another tab followed or unfollowed: this one shows it too, without asking.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith("tyl:sections:")) sectionsStore.adoptKept();
  });
}

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
