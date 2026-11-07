import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSession } from "../../app/session";
import { forgetBoard, keepBoard, loadBoardIndex, loadKeptBoard, loadMyLists } from "../../lib/api";
import { ownPictureUrl } from "../../lib/pictures";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import {
  AccountChanged,
  BoardSyncContext,
  NOBODY,
  publishedEntryOf,
  type BoardSyncControls,
  type SyncRefusal,
  type SyncStatus,
} from "./boardSync";
import { deviceNameOf } from "./deviceName";
import { owners as siteOwners, type BoardOwners, type GuestBoardsQuestion } from "./owners";
import { markedTitle, type Board } from "./model";
import type { BoardsRepository } from "./repository";
import type { BoardsApi } from "./sync";
import { keepBackUp, readBackUp, syncRecords, type SyncRecords } from "./syncRecords";
import { nextUid } from "./useBoards";
import { oneTabAtATime } from "./oneTab";
import "./boards.css";

/** How long after the last change the boards go up: a drag is many changes, one write. */
export const SYNC_AFTER_MS = 2500;

/**
 * A change to nothing but a game in progress waits longer, and the wait is
 * not put off by the next answer: a game of 250 duels goes up about once a
 * minute, not once an answer, each time with the whole board.
 */
export const PLAY_SYNC_AFTER_MS = 60_000;

/** Each board as it would be without its game, to tell a change to the game alone. */
const withoutPlay = (boards: readonly Board[]): Map<string, string> =>
  new Map(boards.map((board) => [board.uid, JSON.stringify({ ...board, play: null })]));

const sameBoards = (one: Map<string, string>, other: Map<string, string>): boolean =>
  one.size === other.size && [...one].every(([uid, text]) => other.get(uid) === text);

const siteApi: BoardsApi = {
  index: (after) => loadBoardIndex(after),
  board: (uid) => loadKeptBoard(uid),
  keep: (uid, request) => keepBoard(uid, request),
  forget: (uid) => forgetBoard(uid),
  published: () =>
    loadMyLists().then(
      ({ lists }) => lists.map(publishedEntryOf),
      () => null,
    ),
};

/** Where one of the person's own pictures can be seen from: the file in their folder. */
const resolveOwnPicture = (uid: string) => (pictureId: string) => ownPictureUrl(uid, pictureId);

interface BoardSyncProviderProps {
  children: ReactNode;
  repository?: BoardsRepository;
  store?: KeyValueStore;
  owners?: BoardOwners;
  api?: BoardsApi;
  resolvePicture?: (uid: string) => (pictureId: string) => Promise<string | null>;
  deviceName?: string | null;
  now?: () => number;
  syncAfterMs?: number;
  playSyncAfterMs?: number;
}

/**
 * The engine itself, fetched with the first run: only a signed-in account
 * syncs, and a visitor following a link never needs it.
 */
const engine = () => import("./sync");

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
  uid,
  records,
  api,
  stillMine,
  inFlight,
  onRunEnded,
  onOff,
}: {
  store: KeyValueStore;
  uid: string;
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
  if (records !== null) {
    const { forgetAccountCopies, SyncCancelled } = await engine();
    // A deletion stopped because the account changed under it, as the caller is told it.
    await forgetAccountCopies(api, records, stillMine).catch((reason: unknown) => {
      throw reason instanceof SyncCancelled ? new AccountChanged() : reason;
    });
  }
  keepBackUp(store, uid, false);
  onOff();
}

/** Every live board on the account, by title: what boards moving in have to be told apart from. */
async function accountTitles(api: BoardsApi): Promise<Set<string>> {
  const { liveEntriesOf } = await engine();
  const live = await liveEntriesOf(api);
  return new Set(live.map((entry) => entry.title));
}

/**
 * Keeps this browser's boards and the account's the same, the way the phone
 * does: a run on sign-in and on arrival, a run a moment after any change, a
 * run when the connection comes back. Only the account's own boards take
 * part: those made without an account stay out unless the person moves them
 * in, which a guest turned account does unasked and anybody else is asked.
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
  owners = siteOwners,
  // Bound to this account, not to whoever is here: a late write of a run
  // that outlived a sign-out still lands with the account it belongs to.
  repository = uid === null ? owners.boards : owners.of(uid),
  store = localStorageStore,
  api = siteApi,
  resolvePicture = resolveOwnPicture,
  deviceName = typeof navigator === "undefined" ? null : deviceNameOf(navigator.userAgent),
  now = Date.now,
  syncAfterMs = SYNC_AFTER_MS,
  playSyncAfterMs = PLAY_SYNC_AFTER_MS,
}: BoardSyncProviderProps & { uid: string | null }) {
  const [backUp, setBackUpState] = useState(() => uid === null || readBackUp(store, uid));
  const [status, setStatus] = useState<SyncStatus>("idle");
  const records = useMemo<SyncRecords | null>(
    () => (uid === null ? null : syncRecords(store, uid)),
    [store, uid],
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(
    () => records?.lastSyncedAt() ?? null,
  );
  const [refusals, setRefusals] = useState<readonly SyncRefusal[]>([]);
  const question = useSyncExternalStore(owners.subscribeQuestion, owners.question, owners.question);
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
    if (uid === null || records === null || !backUp || stopping.current) {
      return Promise.resolve();
    }
    if (running.current !== null) {
      again.current = true;
      return running.current;
    }
    const started = epoch.current;
    const stillWanted = () => mounted.current && epoch.current === started;
    setStatus("syncing");
    const promise = oneTabAtATime(async () => {
      const { syncBoards } = await engine();
      return syncBoards({
        repository,
        api,
        records,
        deviceName,
        now,
        nextUid,
        resolvePicture: resolvePicture(uid),
        stillWanted,
      });
    })
      .then(
        (report) => {
          if (!stillWanted()) return;
          setStatus(report.refused > 0 ? "stuck" : "idle");
          // A run that saw every board says which the account still refuses; one stopped midway does not know.
          if (!report.cancelled) setRefusals(report.refusals);
        },
        () => {
          if (stillWanted()) setStatus("stuck");
        },
      )
      .finally(() => {
        running.current = null;
        if (!stillWanted()) {
          // This run belonged to a mount or an epoch that is over. A run asked
          // for meanwhile by the one that took over is that one's, and still
          // owed: StrictMode's second mount asks while the first's run is
          // ending, and a new device then never fetched the account's boards.
          const owed = again.current && mounted.current && !stopping.current;
          again.current = false;
          if (owed) void runAgain.current();
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

  // On sign-in, or with a page that opens signed in.
  useEffect(() => {
    if (uid === null || !backUp) return;
    void run();
  }, [uid, backUp, run]);

  // A moment after the last change, and when the connection comes back.
  useEffect(() => {
    if (uid === null || !backUp) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seen = withoutPlay(repository.all());
    const soon = () => {
      const boards = withoutPlay(repository.all());
      const playOnly = sameBoards(seen, boards);
      seen = boards;
      // A run already on its way takes the game with it.
      if (playOnly && timer !== null) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = null;
          void run();
        },
        playOnly ? playSyncAfterMs : syncAfterMs,
      );
    };
    const stop = repository.subscribe(soon);
    const onLine = () => void run();
    window.addEventListener("online", onLine);
    return () => {
      stop();
      window.removeEventListener("online", onLine);
      if (timer !== null) clearTimeout(timer);
    };
  }, [uid, backUp, repository, run, syncAfterMs, playSyncAfterMs]);

  const moveIn = useCallback(async () => {
    if (question === null) return;
    // Both sets survive in use; only the two have to be tellable apart first.
    const theirs = await accountTitles(api).catch(() => new Set<string>());
    owners.moveIn(question.owner, (title) =>
      theirs.has(title) ? markedTitle(title, strings.sync.fromThisDevice) : null,
    );
  }, [question, api, owners]);

  const turnOn = useCallback(() => {
    if (uid !== null) keepBackUp(store, uid, true);
    setBackUpState(true);
    return Promise.resolve();
  }, [store, uid]);

  const turnOff = useCallback(() => {
    if (uid === null) return Promise.resolve();
    // Nothing more goes up from here, and a run in flight stops at its next check.
    stopping.current = true;
    epoch.current++;
    return stopBackingUp({
      store,
      uid,
      records,
      api,
      stillMine: bound(),
      inFlight: running.current,
      onRunEnded: () => setStatus("idle"),
      onOff: () => {
        setLastSyncedAt(null);
        setRefusals([]);
        setBackUpState(false);
      },
    }).finally(() => {
      stopping.current = false;
    });
  }, [store, uid, records, api, bound]);

  const setBackUp = useCallback((on: boolean) => (on ? turnOn() : turnOff()), [turnOn, turnOff]);

  const value = useMemo<BoardSyncControls>(
    () => ({
      signedIn: uid !== null,
      backUp,
      setBackUp,
      status,
      lastSyncedAt,
      refusals,
      syncNow: run,
    }),
    [uid, backUp, setBackUp, status, lastSyncedAt, refusals, run],
  );

  return (
    <BoardSyncContext.Provider value={uid === null ? { ...NOBODY, backUp, setBackUp } : value}>
      {children}
      {question !== null && question.owner === uid && (
        <GuestBoardsDialog question={question} moveIn={moveIn} keepHere={owners.keepHere} />
      )}
    </BoardSyncContext.Provider>
  );
}

/**
 * The phone's question after signing into an account used before: the
 * boards made without an account move into it, or stay in this browser,
 * shown whenever nobody is signed in. Nothing is deleted either way.
 */
function GuestBoardsDialog({
  question,
  moveIn,
  keepHere,
}: {
  question: GuestBoardsQuestion;
  moveIn: () => Promise<void>;
  keepHere: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  // Escape and closing are the same answer as Keep: nothing moves, nothing is lost.
  useModal(dialog, () => !busy && keepHere(), ".merge__move");
  const onMove = () => {
    setBusy(true);
    void moveIn().finally(() => setBusy(false));
  };
  return (
    <div className="scrim">
      <div
        ref={dialog}
        className="dialog merge"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        aria-describedby="merge-body"
      >
        <h2 id="merge-title" className="dialog__title">
          {strings.sync.mergeTitle}
        </h2>
        <p id="merge-body" className="dialog__body">
          {fill(strings.sync.mergeBody, { local: plural(strings.boards.count, question.boards) })}
        </p>
        <p className="merge__footnote">{strings.sync.mergeFootnote}</p>
        <div className="dialog__actions">
          <Button onClick={keepHere} disabled={busy}>
            {strings.sync.mergeKeepHere}
          </Button>
          <Button className="merge__move" variant="filled" onClick={onMove} disabled={busy}>
            {strings.sync.mergeMoveIn}
          </Button>
        </div>
      </div>
    </div>
  );
}
