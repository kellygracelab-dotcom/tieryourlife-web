import { useEffect, useSyncExternalStore } from "react";
import type { QueuedList } from "../../api/moderation";
import { useSession } from "../../app/session";
import { loadReports } from "../../lib/api";

/**
 * Whether the person here is the one moderator: the backend says so by
 * answering the queue instead of refusing it. Asked once per account per
 * visit, and only for a signed-in account, so nobody else pays for it.
 */
export type ModeratorState =
  { status: "unknown" } | { status: "no" } | { status: "yes"; reports: QueuedList[] };

export type LoadReports = () => Promise<{ reports: QueuedList[] }>;

let known: { uid: string | null; state: ModeratorState } = {
  uid: null,
  state: { status: "unknown" },
};
let asking: Promise<void> | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => known.state;

function settle(uid: string, state: ModeratorState): void {
  known = { uid, state };
  listeners.forEach((listener) => listener());
}

/** The queue changed under the moderator's hands; the menu's count follows. */
export function noteReports(uid: string, reports: QueuedList[]): void {
  settle(uid, { status: "yes", reports });
}

export function resetModeratorForTests(): void {
  known = { uid: null, state: { status: "unknown" } };
  asking = null;
  listeners.forEach((listener) => listener());
}

export function useModerator(load: LoadReports = loadReports): ModeratorState {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (uid === null) return;
    if (known.uid === uid && known.state.status !== "unknown") return;
    if (asking !== null) return;
    asking = load()
      .then(
        ({ reports }) => settle(uid, { status: "yes", reports }),
        () => settle(uid, { status: "no" }),
      )
      .finally(() => {
        asking = null;
      });
  }, [uid, load]);

  return uid === null || known.uid !== uid ? { status: "unknown" } : state;
}
