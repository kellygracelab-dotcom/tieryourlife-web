import { useCallback, useEffect, useRef, useState } from "react";

/** "Saved." stays this long. */
export const SAVED_NOTE_MS = 6000;

/** What a profile section is doing with its last change. */
export type Saving =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "saved"; publishing: boolean }
  | { status: "failed"; text?: string };

/**
 * A line for a moment after a change, then nothing, so the section rests.
 * "Saved" first says the published lists are being updated, then just "Saved."
 */
export function useSaving(): [Saving, (next: Saving) => void] {
  const [state, setState] = useState<Saving>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback((next: Saving) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setState(next);
    if (next.status === "saved" && !next.publishing) {
      timer.current = setTimeout(() => setState({ status: "idle" }), SAVED_NOTE_MS);
    }
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return [state, set];
}

/** A change on the profile, then the same change on every published list. */
export type Publish = () => Promise<void>;
