import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../app/session";
import { forgetBoard, keepBoard, loadBoardIndex, loadKeptBoard, loadMyLists } from "../../lib/api";
import { ownPictureUrl } from "../../lib/pictures";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import {
  AccountChanged,
  BoardSyncContext,
  NOBODY,
  type BoardSyncControls,
  type MergeChoice,
  type SyncStatus,
} from "./boardSync";
import { deviceNameOf } from "./deviceName";
import { rename, trashBoard, type Board } from "./model";
import { boards as site, type BoardsRepository } from "./repository";
import {
  forgetAccountCopies,
  liveEntriesOf,
  syncBoards,
  SyncCancelled,
  type BoardsApi,
} from "./sync";
import { keepBackUp, readBackUp, syncRecords, type SyncRecords } from "./syncRecords";
import { nextUid } from "./useBoards";
import "./boards.css";

/** How long after the last change the boards go up: a drag is many changes, one write. */
export const SYNC_AFTER_MS = 2500;

const siteApi: BoardsApi = {
  index: (after) => loadBoardIndex(after),
  board: (uid) => loadKeptBoard(uid),
  keep: (uid, request) => keepBoard(uid, request),
  forget: (uid) => forgetBoard(uid),
  published: () =>
    loadMyLists().then(
      ({ lists }) => lists.map((list) => list.id),
      () => null,
    ),
};

/** Where one of the person's own pictures can be seen from: the file in their folder. */
const resolveOwnPicture = (uid: string) => (pictureId: string) => ownPictureUrl(uid, pictureId);

interface BoardSyncProviderProps {
  children: ReactNode;
  repository?: BoardsRepository;
  store?: KeyValueStore;
  api?: BoardsApi;
  resolvePicture?: (uid: string) => (pictureId: string) => Promise<string | null>;
  deviceName?: string | null;
  now?: () => number;
  syncAfterMs?: number;
}

/** A deletion stopped because the account changed under it, as the caller is told it. */
const asAccountChanged = (reason: unknown): never => {
  throw reason instanceof SyncCancelled ? new AccountChanged() : reason;
};

/**
 * Switching the back-up off. Off has to mean the copy is gone, or the switch
 * is a lie: the run in flight ends first, every page of the account's copies
 * goes, and only then is the switch off, in the store and on screen alike.
 * Bound to the mount it started in: should the account change under it,
 * nothing more is asked of the account (its calls go out as whoever is
 * signed in now), the switch stays on, and the caller hears `AccountChanged`.
 */
async function stopBackingUp({
  store,
  records,
  api,
  stillMine,
  inFlight,
  onRunEnded,
  onOff,
}: {
  store: KeyValueStore;
  records: SyncRecords | null;
  api: BoardsApi;
  stillMine: () => boolean;
  inFlight: Promise<void> | null;
  /** The run in flight ended without reporting, as a cancelled run does. */
  onRunEnded: () => void;
  onOff: () => void;
}): Promise<void> {
  if (inFlight !== null) {
    await inFlight.catch(() => undefined);
    if (stillMine()) onRunEnded();
  }
  if (!stillMine()) throw new AccountChanged();
  if (records !== null) await forgetAccountCopies(api, records, stillMine).catch(asAccountChanged);
  keepBackUp(store, false);
  onOff();
}

/** Every live board on the account, by title: what a sign-in has to be told apart from. */
async function accountTitles(api: BoardsApi): Promise<{ count: number; titles: Set<string> }> {
  const live = await liveEntriesOf(api);
  return { count: live.length, titles: new Set(live.map((entry) => entry.title)) };
}

/**
 * Keeps this browser's boards and the account's the same, the way the phone
 * does: a run on sign-in and on arrival, a run a moment after any change, a
 * run when the connection comes back. Asks once, when an account that
 * already has boards is signed into on a browser that has boards too.
 */
export function BoardSyncProvider(props: BoardSyncProviderProps) {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;
  // Everything below is one account's: a sign-out or a change of account starts afresh.
  return (
    <ForAccount key={uid ?? ""} uid={uid} {...props}>
      {props.children}
    </ForAccount>
  );
}

function ForAccount({
  uid,
  children,
  repository = site,
  store = localStorageStore,
  api = siteApi,
  resolvePicture = resolveOwnPicture,
  deviceName = typeof navigator === "undefined" ? null : deviceNameOf(navigator.userAgent),
  now = Date.now,
  syncAfterMs = SYNC_AFTER_MS,
}: BoardSyncProviderProps & { uid: string | null }) {
  const [backUp, setBackUpState] = useState(() => readBackUp(store));
  const [status, setStatus] = useState<SyncStatus>("idle");
  const records = useMemo<SyncRecords | null>(
    () => (uid === null ? null : syncRecords(store, uid)),
    [store, uid],
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(
    () => records?.lastSyncedAt() ?? null,
  );
  const [merge, setMerge] = useState<MergeChoice | null>(null);
  // One run at a time; a change during a run asks for one more after it.
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const runAgain = useRef<() => Promise<void>>(() => Promise.resolve());
  // The lifecycle boundary. A run belongs to one mount of this account and one
  // epoch; the mount ends when the account changes (the key above), the epoch
  // moves on when the back-up is switched off. A run past either writes
  // nothing more and reports nothing: the engine asks before every write.
  const mounted = useRef(true);
  const epoch = useRef(0);
  const stopping = useRef(false);
  /** Whether what started now is still this mount's and this epoch's, asked again after every wait. */
  const bound = useCallback(() => {
    const started = epoch.current;
    return () => mounted.current && epoch.current === started;
  }, []);
  useEffect(() => {
    const life = mounted;
    const era = epoch;
    life.current = true;
    return () => {
      life.current = false;
      era.current++;
    };
  }, []);

  const run = useCallback((): Promise<void> => {
    if (uid === null || records === null || !backUp || !records.merged() || stopping.current) {
      return Promise.resolve();
    }
    if (running.current !== null) {
      again.current = true;
      return running.current;
    }
    const started = epoch.current;
    const stillWanted = () => mounted.current && epoch.current === started;
    setStatus("syncing");
    const promise = syncBoards({
      repository,
      api,
      records,
      deviceName,
      now,
      nextUid,
      resolvePicture: resolvePicture(uid),
      stillWanted,
    })
      .then(
        (report) => {
          if (stillWanted()) setStatus(report.refused > 0 ? "stuck" : "idle");
        },
        () => {
          if (stillWanted()) setStatus("stuck");
        },
      )
      .finally(() => {
        running.current = null;
        if (!stillWanted()) {
          again.current = false;
          return;
        }
        setLastSyncedAt(records.lastSyncedAt());
        if (again.current) {
          again.current = false;
          void runAgain.current();
        }
      });
    running.current = promise;
    return promise;
  }, [uid, records, backUp, repository, api, deviceName, now, resolvePicture]);
  useEffect(() => {
    runAgain.current = run;
  }, [run]);

  // On sign-in, or with a page that opens signed in: the question first if it
  // arises, the run otherwise.
  useEffect(() => {
    if (uid === null || records === null || !backUp) return;
    let current = true;
    if (records.merged()) {
      void run();
      return;
    }
    const local = repository.all().filter((board) => board.deletedAt === null).length;
    accountTitles(api).then(
      ({ count }) => {
        if (!current) return;
        if (count > 0 && local > 0) {
          setMerge({ accountBoards: count, localBoards: local });
        } else {
          records.markMerged();
          void run();
        }
      },
      // The account could not be read: unknown is not empty, and empty would merge without asking.
      () => current && setStatus("stuck"),
    );
    return () => {
      current = false;
    };
  }, [uid, records, backUp, repository, api, run]);

  // A moment after the last change, and when the connection comes back.
  useEffect(() => {
    if (uid === null || !backUp) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, syncAfterMs);
    };
    const stop = repository.subscribe(soon);
    const onLine = () => void run();
    window.addEventListener("online", onLine);
    return () => {
      stop();
      window.removeEventListener("online", onLine);
      if (timer !== null) clearTimeout(timer);
    };
  }, [uid, backUp, repository, run, syncAfterMs]);

  const decideMerge = useCallback(
    async (choice: "keep" | "account") => {
      if (records === null) return;
      const mine = bound();
      const at = now();
      const live = repository.all().filter((board) => board.deletedAt === null);
      if (choice === "account") {
        // Both sets survive: this device's go to the trash, where Restore waits.
        repository.saveAll(live.map((board) => trashBoard(board, at)));
      } else {
        // Both survive in use; only the two sets have to be tellable apart first.
        const theirs = await accountTitles(api).then(
          ({ titles }) => titles,
          () => new Set<string>(),
        );
        // The account changed while its titles were read: the question was another mount's.
        if (!mine()) return;
        const clashing = live.filter((board) => theirs.has(board.title));
        if (clashing.length > 0) {
          repository.saveAll(
            clashing.map((board: Board) =>
              rename(board, `${board.title} ${strings.sync.fromThisDevice}`, at),
            ),
          );
        }
      }
      records.markMerged();
      setMerge(null);
      await run();
    },
    [records, repository, api, now, run, bound],
  );

  const turnOn = useCallback(() => {
    keepBackUp(store, true);
    setBackUpState(true);
    return Promise.resolve();
  }, [store]);

  const turnOff = useCallback(() => {
    // Nothing more goes up from here, and a run in flight stops at its next check.
    stopping.current = true;
    epoch.current++;
    return stopBackingUp({
      store,
      records,
      api,
      stillMine: bound(),
      inFlight: running.current,
      onRunEnded: () => setStatus("idle"),
      onOff: () => {
        setLastSyncedAt(null);
        setBackUpState(false);
      },
    }).finally(() => {
      stopping.current = false;
    });
  }, [store, records, api, bound]);

  const setBackUp = useCallback((on: boolean) => (on ? turnOn() : turnOff()), [turnOn, turnOff]);

  const value = useMemo<BoardSyncControls>(
    () => ({
      signedIn: uid !== null,
      backUp,
      setBackUp,
      status,
      lastSyncedAt,
      syncNow: run,
      merge,
      decideMerge,
    }),
    [uid, backUp, setBackUp, status, lastSyncedAt, run, merge, decideMerge],
  );

  return (
    <BoardSyncContext.Provider value={uid === null ? { ...NOBODY, backUp, setBackUp } : value}>
      {children}
      {merge !== null && <MergeDialog choice={merge} decide={decideMerge} />}
    </BoardSyncContext.Provider>
  );
}

/**
 * The phone's merge sheet: keep everything, or use the account's boards and
 * send this device's to the trash. Nothing is deleted either way.
 */
function MergeDialog({
  choice,
  decide,
}: {
  choice: MergeChoice;
  decide: (choice: "keep" | "account") => Promise<void>;
}) {
  const [picked, setPicked] = useState<"keep" | "account">("keep");
  const [busy, setBusy] = useState(false);
  const total = choice.accountBoards + choice.localBoards;
  const onContinue = () => {
    setBusy(true);
    void decide(picked).finally(() => setBusy(false));
  };
  return (
    <div className="scrim">
      <div className="dialog merge" role="dialog" aria-modal="true" aria-labelledby="merge-title">
        <h2 id="merge-title" className="dialog__title">
          {strings.sync.mergeTitle}
        </h2>
        <p className="dialog__body">
          {fill(strings.sync.mergeBody, {
            account: plural(strings.boards.count, choice.accountBoards),
            local: plural(strings.boards.count, choice.localBoards),
          })}
        </p>
        <div className="merge__options" role="radiogroup" aria-label={strings.sync.mergeTitle}>
          <div className="merge__option">
            <input
              id="merge-keep"
              type="radio"
              name="merge"
              checked={picked === "keep"}
              onChange={() => setPicked("keep")}
              disabled={busy}
            />
            <label className="merge__text" htmlFor="merge-keep">
              <span className="merge__title">
                {strings.sync.mergeKeep}
                <span className="merge__recommended">{strings.sync.mergeRecommended}</span>
              </span>
              <span className="merge__sub">
                {fill(strings.sync.mergeKeepSub, { total: plural(strings.boards.count, total) })}
              </span>
            </label>
          </div>
          <div className="merge__option">
            <input
              id="merge-account"
              type="radio"
              name="merge"
              checked={picked === "account"}
              onChange={() => setPicked("account")}
              disabled={busy}
            />
            <label className="merge__text" htmlFor="merge-account">
              <span className="merge__title">{strings.sync.mergeAccount}</span>
              <span className="merge__sub">
                {fill(strings.sync.mergeAccountSub, {
                  local: plural(strings.boards.count, choice.localBoards),
                })}
              </span>
            </label>
          </div>
        </div>
        <p className="merge__footnote">{strings.sync.mergeFootnote}</p>
        <div className="dialog__actions">
          <Button variant="filled" onClick={onContinue} disabled={busy}>
            {strings.sync.mergeContinue}
          </Button>
        </div>
      </div>
    </div>
  );
}
