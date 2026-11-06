import type { KeepBoardRequest, KeptBoard, KeptBoardEntry } from "../../api/boards";
import { errorOf } from "../../api/errors";
import { fingerprintOf as digest } from "./fingerprint";
import { setPublished, trashBoard, type Board, type BoardItem, type NextUid } from "./model";
import { parseBoard, type BoardsRepository } from "./repository";
import { planSync, type RemoteBoard, type SyncedBoard, type SyncStep } from "./syncPlan";
import type { SyncRecords } from "./syncRecords";

/**
 * Carries out a sync run; the thinking is in `planSync`, which is pure. A
 * step that fails is counted and the run carries on with the next board: the
 * next run recomputes from the same lists, so nothing is remembered between.
 * The phone's `BoardSyncEngine`, step for step.
 */

/** What the engine asks of the network; a test hands in a fake. */
export interface BoardsApi {
  index(after: string | null): Promise<{ boards: KeptBoardEntry[]; next: string | null }>;
  board(uid: string): Promise<KeptBoard>;
  keep(uid: string, request: KeepBoardRequest): Promise<{ uid: string; revision: number }>;
  forget(uid: string): Promise<void>;
  /** The lists this account has in the feed, or null when they could not be read. */
  published(): Promise<PublishedEntry[] | null>;
}

/** One of the account's published lists, as `lists/mine` names it. */
export interface PublishedEntry {
  id: string;
  /** The board it was published from; null on lists published before the server kept it. */
  boardUid: string | null;
  /** When it last went out. */
  updatedAt: number;
}

export interface SyncDeps {
  repository: BoardsRepository;
  api: BoardsApi;
  records: SyncRecords;
  deviceName: string | null;
  now: () => number;
  nextUid: NextUid;
  fingerprintOf?: (board: Board) => Promise<string>;
  /** Where a picture of the person's own can be seen from, by its id; null when it cannot be found. */
  resolvePicture?: (pictureId: string) => Promise<string | null>;
  /**
   * Whether the run is still wanted: asked before every write to the account,
   * the store or the records. False once the account changed under the run or
   * the back-up was switched off, and the run stops there, cancelled.
   */
  stillWanted?: () => boolean;
}

export interface SyncReport {
  carried: number;
  refused: number;
  /** Steps left for the next run: the board moved here while the account's copy was on its way. */
  deferred: number;
  /** Stopped before the end because it was no longer wanted; nothing after the stop was written. */
  cancelled: boolean;
}

/** Thrown inside a run the moment it is no longer wanted. */
export class SyncCancelled extends Error {
  constructor() {
    super("sync cancelled");
    this.name = "SyncCancelled";
  }
}

/** The lifecycle boundary: every side effect of a run stands behind this. */
function check(deps: SyncDeps): void {
  if (deps.stillWanted !== undefined && !deps.stillWanted()) throw new SyncCancelled();
}

const request = (
  board: Board,
  fingerprint: string,
  basedOn: number | null,
  deviceName: string | null,
): KeepBoardRequest => ({
  basedOn,
  deviceName,
  fingerprint,
  title: board.title,
  displayMode: board.displayMode,
  category: board.category,
  coverImageUrl: board.coverImageUrl,
  coverImageUrls: board.coverImageUrls,
  authorName: board.authorName,
  publishedId: board.publishedId,
  deletedAt: board.deletedAt,
  // The account keeps it only when true, as the app writes it.
  ...(board.anonymous ? { anonymous: true } : {}),
  ...(board.play === null ? {} : { play: board.play }),
  tiers: board.tiers.map((tier) => ({
    uid: tier.uid,
    position: tier.position,
    label: tier.label,
    caption: tier.caption,
    colorLight: tier.colorLight,
    colorDark: tier.colorDark,
    isPool: tier.isPool,
  })),
  items: board.items.map((item) => ({
    uid: item.uid,
    pictureId: item.pictureId,
    tierUid: item.tierUid,
    position: item.position,
    title: item.title,
    imageUrl: item.imageUrl,
    ...(item.credit === null ? {} : { credit: item.credit }),
    source: item.source,
    deletedAt: item.deletedAt,
  })),
});

/** The board the account refused a write over, when the refusal carried one. */
function conflictBoard(reason: unknown): KeptBoard | null {
  const error = errorOf(reason);
  if (error.kind !== "conflict" || error.board === undefined) return null;
  const parsed = error.board as Partial<KeptBoard> | null;
  return parsed !== null && typeof parsed === "object" && typeof parsed.revision === "number"
    ? (parsed as KeptBoard)
    : null;
}

export async function syncBoards(deps: SyncDeps): Promise<SyncReport> {
  const { repository, api, records, now } = deps;
  const fingerprintOf = deps.fingerprintOf ?? digest;

  let carried = 0;
  let refused = 0;
  let deferred = 0;
  try {
    const local = repository.all();
    const fingerprints = new Map<string, string>();
    for (const board of local) fingerprints.set(board.uid, await fingerprintOf(board));

    check(deps);
    const remote = await readIndex(api);
    const steps = planSync(
      local.map((board) => ({
        uid: board.uid,
        fingerprint: fingerprints.get(board.uid) ?? "",
        inTrash: board.deletedAt !== null,
      })),
      [...remote.values()],
      records.all(),
    );

    for (const step of steps) {
      check(deps);
      try {
        if ((await carry(step, deps, fingerprintOf, fingerprints)) === "deferred") deferred++;
        else carried++;
      } catch (reason: unknown) {
        if (reason instanceof SyncCancelled) throw reason;
        refused++;
      }
    }

    try {
      await forgetWhatIsNoLongerPublished(deps);
    } catch (reason: unknown) {
      if (reason instanceof SyncCancelled) throw reason;
      // The published ids are a convenience; the boards themselves went through.
    }

    // Only after a complete run: a partial one leaves the account behind,
    // which is what this time is there to report.
    check(deps);
    if (refused === 0) records.markSynced(now());
    return { carried, refused, deferred, cancelled: false };
  } catch (reason: unknown) {
    if (reason instanceof SyncCancelled) return { carried, refused, deferred, cancelled: true };
    throw reason;
  }
}

/** Every live board the account keeps, page after page: the index is paged, and nothing may stop at the first. */
export async function liveEntriesOf(api: BoardsApi): Promise<KeptBoardEntry[]> {
  const live: KeptBoardEntry[] = [];
  let after: string | null = null;
  do {
    const page: { boards: KeptBoardEntry[]; next: string | null } = await api.index(after);
    live.push(...page.boards.filter((entry) => !entry.deleted));
    after = page.next;
  } while (after !== null);
  return live;
}

/**
 * Switching the back-up off: every live board the account keeps becomes a
 * marker, page after page, and this device forgets its agreement about it.
 * Stops with `SyncCancelled` once no longer wanted. A forget the account
 * already answered is still written down: the marker exists, and a record
 * left behind would discard the board on the next sign-in.
 */
export async function forgetAccountCopies(
  api: BoardsApi,
  records: SyncRecords,
  stillWanted: () => boolean,
): Promise<void> {
  const live = await liveEntriesOf(api);
  for (const entry of live) {
    if (!stillWanted()) throw new SyncCancelled();
    await api.forget(entry.uid);
    records.forget(entry.uid);
  }
  if (!stillWanted()) throw new SyncCancelled();
  records.clear();
}

async function readIndex(api: BoardsApi): Promise<Map<string, RemoteBoard>> {
  const found = new Map<string, RemoteBoard>();
  let after: string | null = null;
  do {
    const page: { boards: KeptBoardEntry[]; next: string | null } = await api.index(after);
    for (const entry of page.boards) {
      found.set(entry.uid, {
        uid: entry.uid,
        revision: entry.revision,
        deleted: entry.deleted,
        fingerprint: entry.fingerprint,
      });
    }
    after = page.next;
  } while (after !== null);
  return found;
}

/**
 * One step. `planned` holds the fingerprints the plan was made from: a step
 * that would write over a board which moved here since is deferred to the
 * next run, which the move itself has already asked for.
 */
async function carry(
  step: SyncStep,
  deps: SyncDeps,
  fingerprintOf: (board: Board) => Promise<string>,
  planned: ReadonlyMap<string, string>,
): Promise<"carried" | "deferred"> {
  const { repository, api, records } = deps;
  switch (step.kind) {
    case "create":
      await send(step.uid, null, deps, fingerprintOf);
      return "carried";
    case "update":
    case "revive":
      await send(step.uid, step.basedOn, deps, fingerprintOf);
      return "carried";
    case "keepBoth": {
      // Theirs comes down first, so it is safe here even if the write below never happens.
      const theirs = await api.board(step.uid);
      await adopt(theirs, true, deps, fingerprintOf);
      sawTheirs(deps, theirs);
      await send(step.uid, step.basedOn, deps, fingerprintOf);
      return "carried";
    }
    case "restore":
      return takeOver(await api.board(step.uid), planned.get(step.uid), deps, fingerprintOf);
    case "adopt":
      await adopt(await api.board(step.uid), false, deps, fingerprintOf);
      return "carried";
    case "trashLocal":
      return trashHere(step.uid, step.revision, planned.get(step.uid), deps, fingerprintOf);
    case "letGo":
      check(deps);
      records.forget(step.uid);
      return "carried";
    case "forget":
      check(deps);
      await api.forget(step.uid);
      check(deps);
      records.forget(step.uid);
      return "carried";
    case "remember": {
      const board = repository.get(step.uid);
      if (board === null) return "carried";
      // The fingerprint the plan agreed on, kept from the start of the run;
      // computed once more only if it was not. No wait between the check and the write.
      const fingerprint = planned.get(step.uid) ?? (await fingerprintOf(board));
      check(deps);
      agree(deps, { uid: step.uid, revision: step.revision, fingerprint });
      return "carried";
    }
  }
}

/**
 * On a refused write the account's copy is kept beside ours under a new uid,
 * then ours goes up against the revision the refusal named.
 */
async function send(
  uid: string,
  basedOn: number | null,
  deps: SyncDeps,
  fingerprintOf: (board: Board) => Promise<string>,
): Promise<void> {
  const { repository, api, records, deviceName } = deps;
  const board = repository.get(uid);
  if (board === null) return;
  const fingerprint = await fingerprintOf(board);
  check(deps);
  try {
    const answer = await api.keep(uid, request(board, fingerprint, basedOn, deviceName));
    check(deps);
    agree(deps, { uid, revision: answer.revision, fingerprint });
    return;
  } catch (reason: unknown) {
    if (reason instanceof SyncCancelled) throw reason;
    const theirs = conflictBoard(reason);
    if (theirs === null) throw reason;
    check(deps);
    // Our own board coming back: the last write's answer never arrived. Same
    // content, so take the missed number and stop; otherwise a copy of your
    // own board appears every time.
    if (theirs.fingerprint !== null && theirs.fingerprint === fingerprint) {
      agree(deps, { uid, revision: theirs.revision, fingerprint });
      return;
    }
    // The board as last agreed, written again by another device: nothing in
    // it is new, so ours goes over it without a copy.
    const agreed = records.all().find((record) => record.uid === uid)?.fingerprint;
    if (theirs.fingerprint === null || theirs.fingerprint !== agreed) {
      await adopt(theirs, true, deps, fingerprintOf);
      sawTheirs(deps, theirs);
    }
    check(deps);
    const second = await api.keep(uid, request(board, fingerprint, theirs.revision, deviceName));
    check(deps);
    agree(deps, { uid, revision: second.revision, fingerprint });
  }
}

/**
 * Their version is kept here as a copy: written down as seen, before ours goes
 * up. When ours is then refused (too big, a bad field, no network), the next
 * run reads the board as changed here only and sends it again, instead of
 * making one more copy of theirs every run.
 */
function sawTheirs(deps: SyncDeps, theirs: KeptBoard): void {
  check(deps);
  agree(deps, {
    uid: theirs.uid,
    revision: theirs.revision,
    fingerprint: theirs.fingerprint ?? "",
  });
}

/**
 * A marker for a board nothing changed here since the agreement: into this
 * device's trash, and the agreement moved to the marker. Waits for the next
 * run when the board moved while the run was on its way.
 */
async function trashHere(
  uid: string,
  revision: number,
  plannedFingerprint: string | undefined,
  deps: SyncDeps,
  fingerprintOf: (board: Board) => Promise<string>,
): Promise<"carried" | "deferred"> {
  const board = deps.repository.get(uid);
  if (board === null) return "deferred";
  const trashed = trashBoard(board, deps.now());
  const [now, fingerprint] = await Promise.all([fingerprintOf(board), fingerprintOf(trashed)]);
  check(deps);
  const latest = deps.repository.get(uid);
  if (latest === null || !sameBoard(latest, board) || now !== plannedFingerprint) return "deferred";
  if (trashed !== board) keep(deps, trashed);
  agree(deps, { uid, revision, fingerprint });
  return "carried";
}

/**
 * Writes down that this device and the account agree about a board, only
 * while the board is in the browser's storage. One the browser refused is
 * held for the visit and gone after a reload, and an agreement about it would
 * then read as thrown away here: the next run would take it out of the
 * account and off every other device. Without the record, the next visit
 * brings the account's copy down instead, or its newer version of an edit.
 */
function agree(deps: SyncDeps, record: SyncedBoard): void {
  if (deps.repository.kept(record.uid)) deps.records.remember(record);
}

/** A kept board as one of ours: the account's fields, and this device's own set afresh. */
function boardOf(incoming: KeptBoard, now: number): Board | null {
  const parsed = parseBoard({ ...incoming, editedAt: incoming.updatedAt || now });
  return parsed === null
    ? null
    : {
        ...parsed,
        favouritedAt: null,
        arrivedFrom: null,
        publishedEditedAt: null,
        topic: null,
        takenFrom: null,
        rankingOf: null,
      };
}

/**
 * The account's copy replaces what is here, uid and all; the star stays, it
 * is this device's. Not when the board here moved while the copy was on its
 * way: writing then would put the account's older version over an edit made
 * a moment ago. The step waits for the next run, where both changes meet.
 */
async function takeOver(
  incoming: KeptBoard,
  plannedFingerprint: string | undefined,
  deps: SyncDeps,
  fingerprintOf: (board: Board) => Promise<string>,
): Promise<"carried" | "deferred"> {
  const existing = deps.repository.get(incoming.uid);
  if (existing === null) {
    await adopt(incoming, false, deps, fingerprintOf);
    return "carried";
  }
  const fresh = boardOf(incoming, deps.now());
  if (fresh === null) throw new Error(`The account's copy of ${incoming.uid} could not be read`);
  const board = await withPictures(fresh, deps);
  // Everything that waits is gathered first: the copy's own fingerprint, and
  // the fingerprint of the board here as it is now. Then the checks, and the
  // writes, with no wait between them: the board read last is the one judged.
  const fingerprint = await fingerprintOf(board);
  const current = deps.repository.get(incoming.uid);
  if (current === null) return "deferred";
  const currentFingerprint = await fingerprintOf(current);
  check(deps);
  const latest = deps.repository.get(incoming.uid);
  if (
    latest === null ||
    !sameBoard(latest, current) ||
    (plannedFingerprint !== undefined && currentFingerprint !== plannedFingerprint)
  ) {
    return "deferred";
  }
  // The star, the origin, the topic, the list it was saved from and the
  // ranking it is out as are this device's, and read at the moment of writing.
  keep(deps, {
    ...board,
    favouritedAt: latest.favouritedAt,
    arrivedFrom: latest.arrivedFrom,
    topic: latest.topic,
    takenFrom: latest.takenFrom,
    rankingOf: latest.rankingOf,
  });
  deps.records.remember({ uid: board.uid, revision: incoming.revision, fingerprint });
  return "carried";
}

/** Thrown when the browser would not keep a board the account sent. */
export class StorageRefused extends Error {
  constructor() {
    super("this browser would not keep the board");
    this.name = "StorageRefused";
  }
}

/**
 * Writes a board the account sent, or stops the run. A board that was never
 * kept must not be written down as agreed on: the next run would read it as
 * thrown away here and take it out of the account, and then out of every
 * other device.
 */
function keep(deps: SyncDeps, board: Board): void {
  if (!deps.repository.save(board)) throw new StorageRefused();
}

/** The same board, field for field: the store hands out a fresh object every time. */
const sameBoard = (left: Board, right: Board): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * As itself when it is news from another device; as a copy with a new uid
 * when it lost to the board already here: two boards a person can sort out,
 * a silent overwrite they cannot.
 */
async function adopt(
  incoming: KeptBoard,
  asCopy: boolean,
  deps: SyncDeps,
  fingerprintOf: (board: Board) => Promise<string>,
): Promise<void> {
  const fresh = boardOf(incoming, deps.now());
  if (fresh === null) throw new Error(`The account's copy of ${incoming.uid} could not be read`);
  const board = await withPictures(
    asCopy ? renamed(fresh, incoming.deviceName, deps.nextUid) : fresh,
    deps,
  );
  // The fingerprint before the writes, so nothing waits between the check and them.
  const fingerprint = asCopy ? null : await fingerprintOf(board);
  check(deps);
  keep(deps, board);
  if (fingerprint === null) return;
  deps.records.remember({ uid: board.uid, revision: incoming.revision, fingerprint });
}

/** Every uid new, so the copy and the original never meet; where it came from written on it; not the published list. */
function renamed(board: Board, from: string | null, nextUid: NextUid): Board {
  const tierUids = new Map(board.tiers.map((tier) => [tier.uid, nextUid()]));
  return {
    ...board,
    uid: nextUid(),
    arrivedFrom: from,
    publishedId: null,
    rankingOf: null,
    tiers: board.tiers.map((tier) => ({ ...tier, uid: tierUids.get(tier.uid) ?? tier.uid })),
    items: board.items.map((item) => ({
      ...item,
      uid: nextUid(),
      tierUid: tierUids.get(item.tierUid) ?? item.tierUid,
    })),
  };
}

/** A card with a picture of the person's own and no address for it yet: the address is looked up, best effort. */
async function withPictures(board: Board, deps: SyncDeps): Promise<Board> {
  const resolve = deps.resolvePicture;
  if (resolve === undefined) return board;
  const items: BoardItem[] = [];
  let changed = false;
  for (const item of board.items) {
    if (
      item.pictureId === null ||
      (item.imageUrl !== null && item.imageUrl.startsWith("https://"))
    ) {
      items.push(item);
      continue;
    }
    const url = await resolve(item.pictureId).catch(() => null);
    items.push(url === null ? item : { ...item, imageUrl: url });
    changed ||= url !== null;
  }
  return changed ? { ...board, items } : board;
}

/**
 * Drops a published id the account no longer has: a snapshot can vanish
 * without this device (taken down, or unpublished elsewhere), and a board
 * still claiming to be public hides the one switch that would fix it. And
 * the other way round, as the phone's #236 does: a board whose publish went
 * through while its answer never came gets its list back, found by the
 * board's uid the account keeps on it.
 */
async function forgetWhatIsNoLongerPublished(deps: SyncDeps): Promise<void> {
  const boards = deps.repository.all();
  const claimed = boards.filter((board) => board.publishedId !== null);
  const unlinked = boards.filter(lostItsList);
  if (claimed.length === 0 && unlinked.length === 0) return;
  const theirs = await deps.api.published();
  if (theirs === null) return;
  check(deps);
  const ids = new Set(theirs.map((entry) => entry.id));
  // Read again after the wait: a board may have moved here meanwhile, and
  // only the publication is this step's to change, and only while it is still the one
  // that was asked about. Everything else is kept as it is now.
  const gone = claimed.flatMap((asked) => {
    const board = deps.repository.get(asked.uid);
    const id = board?.publishedId ?? null;
    return board !== null && id !== null && id === asked.publishedId && !ids.has(id) ? [board] : [];
  });
  // Private again, the board is one's own: the name publishing put on it
  // goes, or Your lists would take it for a copy of somebody else's.
  const changed = gone.map((board) => setPublished(board, null, null, deps.now()));
  for (const [uid, entry] of relinks(unlinked, theirs, deps.repository.all())) {
    const board = deps.repository.get(uid);
    if (board === null || !lostItsList(board)) continue;
    // Its own edit time stays, as on the phone: an edit made after the list
    // went out still reads as not sent, and Update has it to send.
    changed.push({
      ...board,
      publishedId: entry.id,
      publishedEditedAt: Math.min(board.editedAt, entry.updatedAt),
    });
  }
  if (changed.length > 0) deps.repository.saveAll(changed);
}

/** A board that may have lost its list: out as nothing, and with the section every publish needs. */
const lostItsList = (board: Board): boolean =>
  board.publishedId === null &&
  board.rankingOf === null &&
  board.deletedAt === null &&
  board.category !== null &&
  board.category !== "";

/**
 * The list each board gets back, by board uid: only a list no board here
 * claims, and only when the account names a single one for the board.
 */
function relinks(
  unlinked: readonly Board[],
  theirs: readonly PublishedEntry[],
  boards: readonly Board[],
): Map<string, PublishedEntry> {
  const waiting = new Set(unlinked.map((board) => board.uid));
  const claimed = new Set(boards.flatMap((board) => board.publishedId ?? []));
  const found = new Map<string, PublishedEntry[]>();
  for (const entry of theirs) {
    if (entry.boardUid === null || !waiting.has(entry.boardUid) || claimed.has(entry.id)) continue;
    found.set(entry.boardUid, [...(found.get(entry.boardUid) ?? []), entry]);
  }
  const single = new Map<string, PublishedEntry>();
  for (const [uid, entries] of found) {
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) single.set(uid, only);
  }
  return single;
}
