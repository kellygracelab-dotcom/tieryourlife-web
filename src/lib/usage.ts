import type { ApiClient } from "../api/client";
import { errorOf } from "../api/errors";
import { localStorageStore, type KeyValueStore } from "./storage";
import {
  after,
  batchOf,
  counted,
  crashedIn,
  crashOf,
  dayOf,
  dropped,
  freshLedger,
  ledgerOf,
  referrerOf,
  sessionBegun,
  stepped,
  type Ledger,
  type UsageBatch,
  type UsageFeature,
  type UsageReferrer,
  type UsageStep,
} from "./usageLedger";
import { localeTag, SITE_VERSION, USAGE_OFF_KEY, usageOn } from "./usageSwitch";

export const LEDGER_KEY = "tyl:usage";

/** A return within half an hour is the same session: from another tab, the share sheet, a glance elsewhere. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** How long after the page opens what the last visit left is sent, once the account has come. */
export const LEFTOVER_AFTER_MS = 10_000;

export type SendOutcome = "sent" | "refused" | "tooMany" | "failed";

export interface UsageDeps {
  store: KeyValueStore;
  now: () => number;
  /** Sends one batch; `keepalive` as the page goes. */
  send: (batch: UsageBatch, keepalive: boolean) => Promise<SendOutcome>;
  /**
   * Whether the browser has an account already, a guest's or Google's. The
   * batch needs one, and making a guest only to count a visit would fill the
   * project with accounts nobody uses: until there is one, the counts wait.
   */
  hasIdentity: () => boolean;
  version: string;
  locale: () => string | null;
  /** The site's own address, to tell its errors from anybody else's. */
  origin: string;
}

export interface Usage {
  /** A newcomer's step: sent once per browser, ever. */
  step(step: UsageStep): void;
  count(feature: UsageFeature): void;
}

/** Nothing counted: for pages drawn without the site around them. */
export const NO_USAGE: Usage = { step: () => undefined, count: () => undefined };

/** Puts back what a batch took when it did not go. */
function putBack(ledger: Ledger, batch: UsageBatch, before: Ledger): Ledger {
  const counts = { ...ledger.counts };
  for (const [name, n] of Object.entries(batch.features)) counts[name] = (counts[name] ?? 0) + n;
  return {
    ...ledger,
    lastActiveDay: before.lastActiveDay,
    stepsDone: ledger.stepsDone.filter(
      (step) => !batch.steps.includes(step) || before.stepsDone.includes(step),
    ),
    stepsWaiting: [...new Set([...batch.steps, ...ledger.stepsWaiting])],
    counts,
    sessions: ledger.sessions + batch.sessions,
    crashedSessions: ledger.crashedSessions + batch.crashedSessions,
    crashes: [...batch.crashes, ...ledger.crashes].slice(-5),
    referrer: ledger.referrer ?? batch.referrer ?? null,
  };
}

export function createUsage(deps: UsageDeps) {
  const { store, now } = deps;
  const on = () => usageOn(store);
  let inSession = false;
  let crashedThisSession = false;
  let sending = false;

  const returning = (): boolean =>
    (store.keys?.() ?? []).some(
      (key) =>
        key.startsWith("tyl") &&
        key !== LEDGER_KEY &&
        key !== USAGE_OFF_KEY &&
        key !== "tyl:boot-retry",
    );

  const read = (): Ledger => {
    let kept: Ledger | null = null;
    try {
      kept = ledgerOf(JSON.parse(store.read(LEDGER_KEY) ?? "null"));
    } catch {
      kept = null;
    }
    if (kept !== null) return kept;
    const fresh = freshLedger(dayOf(now()), returning(), on());
    store.write(LEDGER_KEY, JSON.stringify(fresh));
    return fresh;
  };
  const update = (change: (ledger: Ledger) => Ledger): void => {
    store.write(LEDGER_KEY, JSON.stringify(change(read())));
  };

  async function send(keepalive: boolean): Promise<void> {
    if (sending) return;
    if (!on()) {
      if (store.read(LEDGER_KEY) !== null) update(dropped);
      return;
    }
    const today = dayOf(now());
    const before = read();
    if (before.quietDay === today || !deps.hasIdentity()) return;
    const batch = batchOf(before, today, deps.version, deps.locale());
    if (batch === null) return;
    sending = true;
    // Taken out before it goes: a tab closing as it sends leaves no answer to
    // wait for, and a batch counted twice is worse than one lost.
    update((ledger) => after(ledger, batch, today));
    try {
      const outcome = await deps.send(batch, keepalive);
      if (outcome === "failed") update((ledger) => putBack(ledger, batch, before));
      // Past the day's batches: what it held waits for tomorrow.
      if (outcome === "tooMany")
        update((ledger) => ({ ...putBack(ledger, batch, before), quietDay: today }));
      // "refused": the server would refuse it again, so it is not sent again.
    } finally {
      sending = false;
    }
  }

  return {
    step(step: UsageStep): void {
      update((ledger) => stepped(ledger, step, on()));
    },
    count(feature: UsageFeature): void {
      if (on()) update((ledger) => counted(ledger, feature));
    },
    /** The page came into sight: a session, unless it is a return within half an hour. */
    begin(referrer: UsageReferrer | null): void {
      if (inSession) return;
      inSession = true;
      crashedThisSession = false;
      if (!on()) return;
      const ledger = read();
      if (ledger.leftAt !== null && now() - ledger.leftAt < SESSION_GAP_MS) return;
      update((kept) => sessionBegun(kept, referrer));
    },
    /** Out of sight or closing: the session's counts go now. */
    leave(): Promise<void> {
      if (!inSession) return Promise.resolve();
      inSession = false;
      if (on()) update((ledger) => ({ ...ledger, leftAt: now() }));
      return send(true);
    },
    /** An error nobody caught, thrown in the site's own code. */
    crashed(error: unknown): void {
      if (!on()) return;
      const crash = crashOf(error, deps.origin);
      if (crash === null) return;
      update((ledger) => crashedIn(ledger, crash, !crashedThisSession));
      crashedThisSession = true;
    },
    /** What is waiting, sent now: what the last visit left. */
    send: () => send(false),
  };
}

export type UsageReporter = ReturnType<typeof createUsage>;

/** The answer to a batch, as the reporter reads it. */
export async function sendBatch(
  client: ApiClient,
  batch: UsageBatch,
  keepalive: boolean,
): Promise<SendOutcome> {
  try {
    await client.request<void>("POST", "/lists/stats", { body: batch, keepalive });
    return "sent";
  } catch (reason) {
    const error = errorOf(reason);
    if (error.kind === "invalid") return "refused";
    if (error.kind === "tooManyRequests") return "tooMany";
    return "failed";
  }
}

/**
 * Starts counting this page: its session, where it came from, its errors, and
 * a batch each time it goes out of sight. Returns the reporter the pages count
 * with.
 */
export function startUsage(
  deps: UsageDeps,
  page: Pick<Window, "addEventListener"> & { document: Document; location: Location },
): UsageReporter {
  const usage = createUsage(deps);
  usage.begin(referrerOf(page.document.referrer, page.location.href));
  page.document.addEventListener("visibilitychange", () => {
    if (page.document.visibilityState === "hidden") void usage.leave();
    else usage.begin(null);
  });
  page.addEventListener("pagehide", () => void usage.leave());
  page.addEventListener("error", (event) => usage.crashed((event as ErrorEvent).error));
  page.addEventListener("unhandledrejection", (event) =>
    usage.crashed((event as PromiseRejectionEvent).reason),
  );
  setTimeout(() => void usage.send(), LEFTOVER_AFTER_MS);
  return usage;
}

let current: Usage = NO_USAGE;

/** What the pages count with: nothing until the site has started counting. */
export const usage: Usage = {
  step: (step) => current.step(step),
  count: (feature) => current.count(feature),
};

export function countWith(reporter: Usage): void {
  current = reporter;
}

export const defaultUsageDeps = (client: ApiClient, hasIdentity: () => boolean): UsageDeps => ({
  store: localStorageStore,
  now: Date.now,
  send: (batch, keepalive) => sendBatch(client, batch, keepalive),
  hasIdentity,
  version: SITE_VERSION,
  locale: () => localeTag(),
  origin: typeof location === "undefined" ? "" : location.origin,
});
