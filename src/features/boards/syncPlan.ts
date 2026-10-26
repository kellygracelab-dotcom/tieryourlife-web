/**
 * What a sync run should do, answered from three lists and nothing else, so
 * it can be tested without a network, a store or a clock. The phone's
 * `BoardSyncPlan`, kept the same so both sides reason alike about a board.
 */

/** A board as it is on this device. */
export interface LocalBoard {
  uid: string;
  /** Stands in for the whole contents: change anything and it changes. Only ever compared. */
  fingerprint: string;
}

/** A board as the account has it, from the index. */
export interface RemoteBoard {
  uid: string;
  revision: number;
  /** True once the board was thrown away; nothing else is left of it. */
  deleted: boolean;
  /** The fingerprint of whichever device wrote it last, if it sent one. */
  fingerprint: string | null;
}

/** What this device knew last time it and the account agreed about a board. */
export interface SyncedBoard {
  uid: string;
  revision: number;
  fingerprint: string;
}

export type SyncStep =
  /** The account has never seen this board. Send it. */
  | { kind: "create"; uid: string }
  /** Changed here and nowhere else. Send it over what the account has. */
  | { kind: "update"; uid: string; basedOn: number }
  /** Changed in the account and not here. Take theirs. */
  | { kind: "restore"; uid: string }
  /** A board this device has never had. Bring it down. */
  | { kind: "adopt"; uid: string }
  /** Changed in both places. The order is the content, so nothing merges: the account's copy arrives as a second board. */
  | { kind: "keepBoth"; uid: string; basedOn: number }
  /** Thrown away somewhere else after this device agreed about it. Let it go here too. */
  | { kind: "discardLocal"; uid: string }
  /**
   * A marker in the account and no agreement here: this device sent the board
   * once and withdrew it (the back-up was switched off, which forgets every
   * agreement), or never agreed at all. The board here is the only one, so it
   * goes up again over the marker. The phone's plan discards in this case; the
   * site keeps the board, because the only record it has of the agreement is
   * one it clears on purpose.
   */
  | { kind: "revive"; uid: string; basedOn: number }
  /** Thrown away here. Tell the account, so the other device lets go as well. */
  | { kind: "forget"; uid: string }
  /** Already the same on both sides. Still a step: the device must write down that they agree, or every run asks again. */
  | { kind: "remember"; uid: string; revision: number };

function stepFor(
  local: LocalBoard,
  remote: RemoteBoard | undefined,
  synced: SyncedBoard | undefined,
): SyncStep | null {
  if (remote === undefined) return { kind: "create", uid: local.uid };
  if (remote.deleted) {
    // Thrown away on another device after both agreed. Keeping it here would
    // make emptying the trash something that only holds on the device you
    // did it on. Without an agreement the marker is this device's own doing.
    return synced === undefined
      ? { kind: "revive", uid: local.uid, basedOn: remote.revision }
      : { kind: "discardLocal", uid: local.uid };
  }
  // Asked first: a store restored from a backup has every board twice with
  // no record of agreeing, and the safe reading would duplicate the lot.
  if (remote.fingerprint !== null && remote.fingerprint === local.fingerprint) {
    return { kind: "remember", uid: local.uid, revision: remote.revision };
  }
  if (synced === undefined) return { kind: "keepBoth", uid: local.uid, basedOn: remote.revision };

  const changedHere = local.fingerprint !== synced.fingerprint;
  const changedThere = remote.revision !== synced.revision;
  if (changedHere && changedThere) {
    return { kind: "keepBoth", uid: local.uid, basedOn: remote.revision };
  }
  if (changedHere) return { kind: "update", uid: local.uid, basedOn: remote.revision };
  if (changedThere) return { kind: "restore", uid: local.uid };
  // Neither side moved and the fingerprints disagree: written before devices
  // sent one. Nothing to do until an edit.
  return null;
}

/**
 * `local` is every board on this device, trash included: emptying the trash
 * on one device means it everywhere. `remote` keeps a marker for every board
 * ever thrown away, so a board missing from it was never sent. `synced` is the
 * last agreement; a record with no board here is how a delete is noticed.
 */
export function planSync(
  local: readonly LocalBoard[],
  remote: readonly RemoteBoard[],
  synced: readonly SyncedBoard[],
): SyncStep[] {
  const remoteByUid = new Map(remote.map((board) => [board.uid, board]));
  const syncedByUid = new Map(synced.map((board) => [board.uid, board]));
  const localUids = new Set(local.map((board) => board.uid));
  const steps: SyncStep[] = [];

  for (const board of local) {
    const step = stepFor(board, remoteByUid.get(board.uid), syncedByUid.get(board.uid));
    if (step !== null) steps.push(step);
  }
  for (const board of remote) {
    if (!localUids.has(board.uid) && !board.deleted && !syncedByUid.has(board.uid)) {
      steps.push({ kind: "adopt", uid: board.uid });
    }
  }
  // Once here, no longer: emptied out of the trash on this device. Nothing
  // else makes this shape.
  for (const record of synced) {
    const stillHere = localUids.has(record.uid);
    const alreadyGone = remoteByUid.get(record.uid)?.deleted ?? true;
    if (!stillHere && !alreadyGone) steps.push({ kind: "forget", uid: record.uid });
  }
  return steps;
}
