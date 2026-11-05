import { useEffect, useState, useSyncExternalStore } from "react";
import { loadAdminCounts } from "../../lib/api";

type Counts = { reports: number; proposals: number };

// How many decisions were made on this page: each one has the count read again.
let decisions = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const decided = () => decisions;

/** A report or a proposal was decided here: the menu's count is asked for again. */
export function noteAdminDecision(): void {
  decisions += 1;
  listeners.forEach((listener) => listener());
}

/**
 * How much waits for an admin, for the pill on the menu's Admin row: open
 * reports and proposals. A backend from before the count answers nothing, and
 * then the reports the menu already holds are the count.
 */
export function useAdminCounts(
  uid: string | null,
  reports: number,
  load: () => Promise<Counts> = loadAdminCounts,
): number {
  const round = useSyncExternalStore(subscribe, decided, decided);
  // The last answer stays up while the next is asked for, so the pill does not flicker.
  const [counted, setCounted] = useState<{ uid: string; value: Counts | null } | null>(null);
  useEffect(() => {
    if (uid === null) return;
    let current = true;
    load().then(
      (value) => current && setCounted({ uid, value }),
      () => current && setCounted({ uid, value: null }),
    );
    return () => {
      current = false;
    };
  }, [uid, load, round]);
  const mine = counted !== null && counted.uid === uid ? counted.value : null;
  return mine === null ? reports : mine.reports + mine.proposals;
}
