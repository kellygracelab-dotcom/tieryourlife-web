import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import type { SaveChoices, SaveToMine } from "./useSaveToMine";
import "./boards.css";

/**
 * "Which ranking to save?": the author's, mine, or none. Shown only while
 * `useSaveToMine` is asking; the copy is made the moment one is chosen.
 */
export function SaveToMineDialog({ saving }: { saving: SaveToMine }) {
  return saving.asking === null ? null : (
    <Question choices={saving.asking} save={saving.save} cancel={saving.cancel} />
  );
}

/** The question itself, mounted only while it is asked, so its focus handling starts and ends with it. */
function Question({
  choices: asking,
  save,
  cancel,
}: {
  choices: SaveChoices;
  save: SaveToMine["save"];
  cancel: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, cancel);

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
