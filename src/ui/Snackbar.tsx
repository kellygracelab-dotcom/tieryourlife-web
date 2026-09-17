import { useEffect } from "react";
import "./Snackbar.css";

export interface SnackbarNotice {
  text: string;
  action?: { text: string; onClick: () => void };
}

/** How long a notice stays; the design's six seconds. */
export const SNACKBAR_MS = 6000;

interface SnackbarProps {
  notice: SnackbarNotice | null;
  onDone: () => void;
}

/** One line at the bottom left, with at most one action, gone by itself. */
export function Snackbar({ notice, onDone }: SnackbarProps) {
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(onDone, SNACKBAR_MS);
    return () => clearTimeout(timer);
  }, [notice, onDone]);

  if (notice === null) return null;
  return (
    <div className="snackbar" role="status">
      <span>{notice.text}</span>
      {notice.action !== undefined && (
        <button
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
