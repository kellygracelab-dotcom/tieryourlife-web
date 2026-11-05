import { useEffect, useRef } from "react";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { InAppNote } from "../../ui/InAppNote";
import { useModal } from "../../ui/useModal";
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
  if (state === "closed") return null;
  return <Keeping state={state} onGoogle={onGoogle} onLinkOnly={onLinkOnly} />;
}

/** The dialog itself, mounted while it is open, so the focus goes in with it and comes back after. */
function Keeping({ state, onGoogle, onLinkOnly }: KeepDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const google = useRef<HTMLButtonElement>(null);
  useModal(box, onLinkOnly, ".keep__google");

  // The button was out of reach while it waited; a failed try gives it back.
  useEffect(() => {
    if (state === "failed") google.current?.focus();
  }, [state]);

  return (
    <div className="scrim" onClick={onLinkOnly}>
      <div
        ref={box}
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
        <InAppNote />
        {state === "failed" && (
          <p className="keep__error" role="alert">
            {strings.keep.failed}
          </p>
        )}
        <button
          ref={google}
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
