import { useEffect, useRef } from "react";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import "./keep.css";

export type KeepState = "closed" | "open" | "busy" | "failed";

interface KeepDialogProps {
  state: KeepState;
  onGoogle: () => void;
  onLinkOnly: () => void;
}

/**
 * The one modal on the ranking path. It comes after the ranking is saved and
 * has a link, and "Keep the link only" is a real exit.
 */
export function KeepDialog({ state, onGoogle, onLinkOnly }: KeepDialogProps) {
  const primary = useRef<HTMLButtonElement>(null);
  const open = state !== "closed";

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onLinkOnly();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onLinkOnly]);

  if (!open) return null;

  return (
    <div className="scrim" onClick={onLinkOnly}>
      <div
        className="keep"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keep-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="keep-title" className="keep__title">
          {strings.keep.title}
        </h2>
        <p className="keep__body">{strings.keep.body}</p>
        {state === "failed" && (
          <p className="keep__error" role="alert">
            {strings.keep.failed}
          </p>
        )}
        <button
          ref={primary}
          type="button"
          className="keep__google"
          onClick={onGoogle}
          disabled={state === "busy"}
        >
          <span className="keep__g" aria-hidden="true">
            G
          </span>
          <span>{state === "busy" ? strings.keep.busy : strings.keep.google}</span>
        </button>
        <Button className="keep__link" onClick={onLinkOnly}>
          {strings.keep.linkOnly}
        </Button>
      </div>
    </div>
  );
}
