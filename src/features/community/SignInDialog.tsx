import { useEffect, useRef } from "react";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";

interface SignInDialogProps {
  open: boolean;
  busy: boolean;
  title: string;
  body: string;
  onSignIn: () => void;
  onCancel: () => void;
}

/** The small dialog before something that needs an account: one reason, one button. */
export function SignInDialog({ open, busy, title, body, onSignIn, onCancel }: SignInDialogProps) {
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="scrim" onClick={busy ? undefined : onCancel}>
      <div
        className="dialog dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="signin-title" className="dialog__title">
          {title}
        </h2>
        <p className="dialog__body">{body}</p>
        <div className="dialog__actions">
          <Button onClick={onCancel} disabled={busy}>
            {strings.follow.cancel}
          </Button>
          <button
            ref={primary}
            type="button"
            className="btn btn--filled"
            onClick={onSignIn}
            disabled={busy}
          >
            <span>{busy ? strings.keep.busy : strings.keep.google}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
