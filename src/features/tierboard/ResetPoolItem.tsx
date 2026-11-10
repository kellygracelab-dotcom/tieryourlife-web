import { useState } from "react";
import { strings } from "../../strings";
import { ConfirmDialog } from "../../ui/ConfirmDialog";

export function ResetPoolItem({ onReset }: { onReset: (() => void) | null }) {
  const [asking, setAsking] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="menu__action"
        aria-haspopup="dialog"
        disabled={onReset === null}
        onClick={() => setAsking(true)}
      >
        {strings.play.resetCards}
      </button>
      {asking && onReset !== null && (
        <ConfirmDialog
          title={strings.play.resetQuestion}
          body={strings.play.resetBody}
          confirmLabel={strings.play.resetConfirm}
          cancelLabel={strings.play.cancel}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            onReset();
          }}
        />
      )}
    </li>
  );
}
