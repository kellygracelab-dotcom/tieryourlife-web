import { useEffect, useRef, useState } from "react";
import "./Snackbar.css";

export interface SnackbarNotice {
  text: string;
  action?: { text: string; onClick: () => void };
  /** Stays as long as the app's long snackbar: an Undo that is the only way back to something. */
  long?: boolean;
}

/** How long a notice stays; the design's six seconds, counted while nobody holds it. */
export const SNACKBAR_MS = 6000;
/** A long notice's time, the app's SnackbarDuration.Long. */
export const SNACKBAR_LONG_MS = 10000;

interface SnackbarProps {
  notice: SnackbarNotice | null;
  onDone: () => void;
}

/**
 * One line at the bottom left, with at most one action, gone by itself.
 * The status region is there before anything is said in it, so the words
 * are read out when they come.
 */
export function Snackbar({ notice, onDone }: SnackbarProps) {
  return (
    <div className="snackbar-region" role="status">
      {notice !== null && <Notice notice={notice} onDone={onDone} />}
    </div>
  );
}

/**
 * The shell's snackbar, for what a page that is gone could not say itself.
 * It is there only while it says something, so the pages' own status regions
 * stay the only ones; an alert is read out as it appears, which a status
 * region that comes with its words already in it is not.
 */
export function SiteSnackbar({ notice, onDone }: SnackbarProps) {
  if (notice === null) return null;
  return (
    <div className="snackbar-region" role="alert">
      <Notice notice={notice} onDone={onDone} />
    </div>
  );
}

/**
 * While the pointer or the focus is on a notice, it waits. An action whose
 * press took the focus with it (a card removed, a list deleted) gets the
 * focus, so its Undo is one Enter away rather than the whole page.
 */
function Notice({ notice, onDone }: { notice: SnackbarNotice; onDone: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const action = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDone, notice.long === true ? SNACKBAR_LONG_MS : SNACKBAR_MS);
    return () => clearTimeout(timer);
  }, [notice, onDone, held]);

  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) action.current?.focus();
  }, [notice]);

  return (
    <div
      className="snackbar"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span>{notice.text}</span>
      {notice.action !== undefined && (
        <button
          ref={action}
          type="button"
          className="snackbar__action"
          onClick={() => {
            notice.action?.onClick();
            onDone();
          }}
        >
          {notice.action.text}
        </button>
      )}
    </div>
  );
}
