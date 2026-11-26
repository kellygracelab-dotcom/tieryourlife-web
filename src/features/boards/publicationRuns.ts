import { useSyncExternalStore } from "react";
import type { AddedCard } from "../../api/community";
import type { ApiError } from "../../api/errors";
import { errorOf } from "../../api/errors";

/**
 * Publish and Update run in the background (Designer's decision, Danylo's yes
 * of 26.11, publish-update-speed BRIEF): the press answers at once, the list
 * stays open, and the person may leave it. So where a send stands is kept
 * here, for the board and the account, not by the page that pressed it: the
 * page met again, Your lists, and the header all read the same run, and a
 * send outlives the page it began on.
 */

export type PublishBusy = "idle" | "publishing" | "updating" | "unpublishing";

/** A refusal, by the press it answers: each is said beside its own button. */
export interface PublishFailure {
  error: ApiError;
  on: "publish" | "update" | "takeDown";
  /** Refused as one's ranking (K3): said in a ranking's words, naming a card of one's own. */
  ranking?: readonly AddedCard[];
}

export interface Run {
  busy: PublishBusy;
  /** Tried three times without a connection: waiting for one to try again. */
  waiting: boolean;
  /** When the send began, for the hint a long one gets (ms). */
  since: number;
  failure: PublishFailure | null;
  /** The backend said the copy goes out only as one's ranking of this list (409 RANK_INSTEAD). */
  rankInstead: string | null;
}

const IDLE: Run = { busy: "idle", waiting: false, since: 0, failure: null, rankInstead: null };

const runs = new Map<string, Run>();
const controllers = new Map<string, AbortController>();
/** The request of each run that is with the server right now. */
const sent = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

const told = () => {
  for (const listener of listeners) listener();
};

export const runOf = (key: string): Run => runs.get(key) ?? IDLE;

/** Changes the run of `key`; one with nothing left to say is forgotten. */
export function changeRun(key: string, part: Partial<Run>): void {
  const next = { ...runOf(key), ...part };
  if (next.busy === "idle") next.waiting = false;
  if (next.busy === "idle" && next.failure === null && next.rankInstead === null) runs.delete(key);
  else runs.set(key, next);
  told();
}

/** A send begins: its signal goes when the person takes the list down meanwhile. */
export function beginRun(key: string, busy: PublishBusy, now = Date.now()): AbortSignal {
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  changeRun(key, { busy, waiting: false, since: now, failure: null, rankInstead: null });
  return controller.signal;
}

/** The send of `key` is over, however it ended. */
export function endRun(key: string, signal: AbortSignal | null): void {
  if (signal !== null && controllers.get(key)?.signal !== signal) return;
  controllers.delete(key);
  changeRun(key, { busy: "idle" });
}

/** A run's request, kept while the server has it, so a takedown can let it finish first. */
export function onItsWay<T>(key: string, call: Promise<T>): Promise<T> {
  const settled = call.then(
    () => undefined,
    () => undefined,
  );
  sent.set(key, settled);
  void settled.then(() => {
    if (sent.get(key) === settled) sent.delete(key);
  });
  return call;
}

/**
 * Take it down while an Update is on its way (BRIEF, 6): the Update stops
 * trying and its answer is not kept. Resolves once a request it already sent
 * is over, so that the takedown reaches the server after it, never before.
 */
export async function cancelRun(key: string): Promise<void> {
  const controller = controllers.get(key);
  if (controller !== undefined) {
    controllers.delete(key);
    controller.abort();
  }
  await sent.get(key);
}

export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRun(key: string): Run {
  return useSyncExternalStore(
    subscribeRuns,
    () => runOf(key),
    () => IDLE,
  );
}

/** Every run, for a page of many boards (Your lists): a new map whenever one changes. */
let everyRun: ReadonlyMap<string, Run> = new Map();
subscribeRuns(() => {
  everyRun = new Map(runs);
});
export function useRuns(): ReadonlyMap<string, Run> {
  return useSyncExternalStore(
    subscribeRuns,
    () => everyRun,
    () => everyRun,
  );
}

/** Whether a board is on its way out now, for Your lists' label (BRIEF, 2). */
export function useSending(board: string): "publishing" | "updating" | null {
  const every = useRuns();
  for (const [key, run] of every) {
    if (!key.startsWith(`${board}:`)) continue;
    if (run.busy === "publishing" || run.busy === "updating") return run.busy;
  }
  return null;
}

/** The key a board's run is kept under, for the account that sends it. */
export const runKey = (board: string, account: string | null | undefined): string =>
  `${board}:${account ?? ""}`;

export function resetRunsForTests(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  sent.clear();
  runs.clear();
  told();
}

/** Tries after a lost connection, before the button waits for one (BRIEF, 4). */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000];
/** While waiting, a try now and then even without word that the connection is back. */
export const WAITING_TRY_MS = 30_000;

/** A failure the network made, worth the same request again: never a refusal. */
export function passing(reason: unknown): boolean {
  const error = errorOf(reason);
  return (
    error.kind === "offline" ||
    error.kind === "unavailable" ||
    (error.kind === "unknown" && error.status >= 500)
  );
}

export interface RetryDeps {
  /** Waits `ms`, or less if the signal goes. */
  pause: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Waits for the connection to come back, or for a while, or for the signal. */
  online: (signal: AbortSignal) => Promise<void>;
}

const pause: RetryDeps["pause"] = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const online: RetryDeps["online"] = (signal) =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, WAITING_TRY_MS);
    window.addEventListener("online", done);
    signal.addEventListener("abort", done, { once: true });
  });

export const retryDeps: RetryDeps = { pause, online };

/**
 * The call until it is answered: a lost connection or a server that is down
 * is tried again three times, then each time the connection may be back,
 * the run saying it waits (BRIEF, 4). A refusal, or the signal, ends it.
 */
export async function retrying<T>(
  call: () => Promise<T>,
  signal: AbortSignal,
  waiting: (now: boolean) => void,
  deps: RetryDeps = retryDeps,
): Promise<T> {
  let tries = 0;
  for (;;) {
    try {
      const answer = await call();
      waiting(false);
      return answer;
    } catch (reason: unknown) {
      if (signal.aborted || !passing(reason)) {
        waiting(false);
        throw reason;
      }
      const delay = RETRY_DELAYS_MS[tries];
      if (delay !== undefined) {
        tries += 1;
        await deps.pause(delay, signal);
      } else {
        waiting(true);
        await deps.online(signal);
      }
      if (signal.aborted) throw reason;
    }
  }
}
