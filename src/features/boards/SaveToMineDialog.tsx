import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import type { SaveToMine } from "./useSaveToMine";
import "./boards.css";

/**
 * "Which ranking to save?": the author's, mine, or none. Shown only while
 * `useSaveToMine` is asking; the copy is made the moment one is chosen.
 */
export function SaveToMineDialog({ saving }: { saving: SaveToMine }) {
  const { asking, save, cancel } = saving;
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const open = asking !== null;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open, cancel]);

  if (asking === null) return null;
  return createPortal(
    <div className="scrim" onClick={cancel}>
      <div
        ref={dialog}
        className="dialog dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {strings.list.saveWhichTitle}
        </h2>
        <p className="dialog__body">{strings.list.saveWhichBody}</p>
        <div className="dialog__actions save-mine__choices">
          {asking.theirs !== null && (
            <Button variant="tonal" onClick={() => save("theirs")}>
              {strings.list.saveTheirs}
            </Button>
          )}
          <Button variant="tonal" onClick={() => save(asking.mine === null ? "none" : "mine")}>
            {asking.mine === null ? strings.list.saveMineEmpty : strings.list.saveMine}
          </Button>
          <Button onClick={cancel}>{strings.rank.cancel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
