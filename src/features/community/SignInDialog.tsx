import { useRef } from "react";
import { createPortal } from "react-dom";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { InAppNote } from "../../ui/InAppNote";
import { useModal } from "../../ui/useModal";

interface SignInDialogProps {
  open: boolean;
  busy: boolean;
  title: string;
  body: string;
  onSignIn: () => void;
  onCancel: () => void;
}

/**
 * The small dialog before something that needs an account: one reason, one
 * button. It lies on the body, so a sticky header that asks it cannot hold it.
 */
export function SignInDialog({ open, ...props }: SignInDialogProps) {
  return open ? createPortal(<Asking {...props} />, document.body) : null;
}

/** The dialog itself, mounted while it is open, so the focus goes in with it and comes back after. */
function Asking({ busy, title, body, onSignIn, onCancel }: Omit<SignInDialogProps, "open">) {
  const box = useRef<HTMLDivElement>(null);
  useModal(
    box,
    () => {
      if (!busy) onCancel();
    },
    ".signin__google",
  );

  return (
    <div className="scrim" onClick={busy ? undefined : onCancel}>
      <div
        ref={box}
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
        <InAppNote />
        <div className="dialog__actions">
          <Button onClick={onCancel} disabled={busy}>
            {strings.follow.cancel}
          </Button>
          <button
            type="button"
            className="btn btn--filled signin__google"
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
