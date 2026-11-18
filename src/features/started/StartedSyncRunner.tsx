import { useEffect } from "react";
import { startedRecordOf } from "../../api/started";
import { useSession } from "../../app/session";
import { forgetStarted, keepStarted, loadStarted } from "../../lib/api";
import { localStorageStore, type KeyValueStore } from "../../lib/storage";
import { strings } from "../../strings";
import { sayOnTheSite } from "../../ui/siteNotice";
import { useBoardSync } from "../boards/boardSync";
import { oneTabAtATime } from "../boards/oneTab";
import { boards as siteBoards } from "../boards/owners";
import type { BoardsRepository } from "../boards/repository";
import { startedChanged, subscribeStarted } from "./started";
import type { StartedApi } from "./startedSync";

const siteApi: StartedApi = {
  load: (since) => loadStarted(since),
  keep: (listId, content, basedOn) => keepStarted(listId, content, basedOn),
  forget: (listId, reason, basedOn, changedAt) => forgetStarted(listId, reason, basedOn, changedAt),
};

/** How often the account is asked what changed on the other devices, while the page is looked at. */
export const STARTED_PULL_MS = 60_000;
/** How often this browser's drafts are looked over for a change of its own. */
export const STARTED_CHECK_MS = 5_000;
/** How long after a change of the arrangement it goes up: a drag is many saves. */
export const STARTED_SOON_MS = 2_500;
/** A game's answers alone wait longer: a game of many duels goes up about once a minute. */
export const STARTED_PLAY_MS = 60_000;

/** The lists saved to one's own: out of Continue, everywhere. */
const savedOf = (repository: BoardsRepository): Set<string> =>
  new Set(
    repository
      .all()
      .flatMap((board) =>
        board.takenFrom !== null && board.deletedAt === null ? [board.takenFrom] : [],
      ),
  );

/** What a run would look at, in two parts: the arrangements and saves, and the games alone. */
function lookOf(store: KeyValueStore, repository: BoardsRepository) {
  let drafts = "";
  let games = "";
  for (const key of (store.keys?.() ?? []).sort()) {
    if (key.startsWith("tyl:draft:") || key.startsWith("tyl:ranking:")) {
      drafts += `${key}=${store.read(key) ?? ""}\n`;
    } else if (key.startsWith("play:list:")) games += `${key}=${store.read(key) ?? ""}\n`;
  }
  return { drafts: drafts + [...savedOf(repository)].sort().join(","), games };
}

/**
 * Continue the same on the phone and here for a signed-in person (shared
 * Continue, 18.11.2026): on sign-in and on coming back to the page, every
 * minute while it is looked at, a moment after a change here, and when the
 * connection comes back. A guest's begun lists stay on the device, as before;
 * so do everybody's while the back-up is off.
 */
export function StartedSync({
  store = localStorageStore,
  api = siteApi,
  repository = siteBoards,
  now = Date.now,
  pullMs = STARTED_PULL_MS,
  checkMs = STARTED_CHECK_MS,
  soonMs = STARTED_SOON_MS,
  playMs = STARTED_PLAY_MS,
}: {
  store?: KeyValueStore;
  api?: StartedApi;
  repository?: BoardsRepository;
  now?: () => number;
  pullMs?: number;
  checkMs?: number;
  soonMs?: number;
  playMs?: number;
}) {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;
  const { backUp } = useBoardSync();

  useEffect(() => {
    if (uid === null || !backUp) return;
    let alive = true;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seen = lookOf(store, repository);

    const run = async (): Promise<void> => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      try {
        const { syncStarted } = await import("./startedSync");
        const report = await oneTabAtATime(() =>
          syncStarted({
            store,
            uid,
            api,
            saved: savedOf(repository),
            now: now(),
            stillWanted: () => alive,
            startedRecordOf,
          }),
        );
        if (!alive) return;
        if (report.changed) startedChanged(false);
        if (report.replaced > 0) sayOnTheSite({ text: strings.started.updatedElsewhere });
      } catch {
        // Tried again with the next change, the next minute or the connection back.
      } finally {
        running = false;
        if (alive) seen = lookOf(store, repository);
        if (again && alive) {
          again = false;
          void run();
        }
      }
    };
    const soon = (after: number, keep = false) => {
      if (timer !== null) {
        if (keep) return;
        clearTimeout(timer);
      }
      timer = setTimeout(() => void run(), after);
    };
    const check = () => {
      const look = lookOf(store, repository);
      if (look.drafts !== seen.drafts) soon(soonMs);
      else if (look.games !== seen.games) soon(playMs, true);
    };
    const looked = () => document.visibilityState === "visible";

    void run();
    const checking = setInterval(check, checkMs);
    const pulling = setInterval(() => {
      if (looked()) void run();
    }, pullMs);
    // A change here (Discard, Undo): up at once, so the other devices have it soon.
    const stop = subscribeStarted((here) => {
      if (here) soon(0);
    });
    const onLine = () => void run();
    // Back to the page: what the phone did meanwhile. Leaving it: what is still to go up goes now.
    const onVisible = () => {
      if (looked()) void run();
      else if (timer !== null) void run();
    };
    window.addEventListener("online", onLine);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(checking);
      clearInterval(pulling);
      if (timer !== null) clearTimeout(timer);
      stop();
      window.removeEventListener("online", onLine);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [uid, backUp, store, api, repository, now, pullMs, checkMs, soonMs, playMs]);

  return null;
}
