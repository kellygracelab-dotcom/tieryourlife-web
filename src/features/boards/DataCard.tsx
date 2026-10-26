import { useCallback, useState } from "react";
import { Link } from "react-router";
import { currentLocale, fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/Icon";
import { useBoardSync } from "./boardSync";
import { trashEntriesOf } from "./model";
import { saveExport } from "./saveExport";
import { useBoards } from "./useBoards";

/** The day and time the reader's language writes them. */
const whenOf = (at: number): string =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(at),
  );

/**
 * The phone's "Your data": whether the boards are kept in the account, the
 * trash with its count. Switching the backup off deletes the account's copy,
 * so it asks first.
 */
export function DataCard() {
  const sync = useBoardSync();
  const boards = useBoards();
  const trashed = trashEntriesOf(boards).length;
  const [asking, setAsking] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Switching off did not go through: the copies may still be there, and the switch stays on.
  const [offFailed, setOffFailed] = useState(false);
  const [exported, setExported] = useState<number | "failed" | null>(null);
  const close = useCallback(() => {
    setAsking(false);
    setOffFailed(false);
  }, []);
  const onExport = () => {
    try {
      setExported(saveExport(boards));
    } catch {
      setExported("failed");
    }
  };
  const turn = (on: boolean) => {
    setSwitching(true);
    setOffFailed(false);
    sync
      .setBackUp(on)
      .then(
        () => setAsking(false),
        () => setOffFailed(true),
      )
      .finally(() => setSwitching(false));
  };
  return (
    <section className="settings__card" aria-labelledby="data-title">
      <h2 id="data-title" className="settings__title">
        {strings.sync.dataTitle}
      </h2>
      {sync.signedIn ? (
        <>
          <div className="settings__row settings__switch">
            <label className="settings__switch-text" htmlFor="backup-switch">
              <span>{strings.sync.backUp}</span>
              <span className="settings__note">{strings.sync.backUpSub}</span>
            </label>
            <input
              id="backup-switch"
              type="checkbox"
              role="switch"
              checked={sync.backUp}
              disabled={switching}
              onChange={(event) => (event.target.checked ? turn(true) : setAsking(true))}
            />
          </div>
          {sync.backUp && (
            <>
              <p className="settings__helper">{strings.sync.backUpNote}</p>
              {sync.status === "stuck" && (
                <p className="settings__bar" role="alert">
                  {fill(strings.sync.stuck, {
                    when: sync.lastSyncedAt === null ? "—" : whenOf(sync.lastSyncedAt),
                  })}
                </p>
              )}
              <div className="settings__actions">
                <Button
                  icon="cloud_upload"
                  onClick={() => void sync.syncNow()}
                  disabled={sync.status === "syncing"}
                >
                  {sync.status === "syncing" ? strings.sync.backingUp : strings.sync.now}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <p className="settings__helper">{strings.sync.guestNote}</p>
      )}
      <Link className="settings__row" to="/trash">
        <span>{strings.sync.trashRow}</span>
        <span className="settings__note">
          {trashed === 0 ? strings.sync.trashEmpty : plural(strings.trash.entries, trashed)}
        </span>
      </Link>
      <button type="button" className="settings__row settings__row--button" onClick={onExport}>
        <span className="settings__switch-text">
          <span>{strings.export.title}</span>
          <span className="settings__note">{strings.export.sub}</span>
        </span>
        <Icon name="download" className="settings__row-icon" />
      </button>
      {exported !== null && (
        <p className="settings__note" role="status">
          {exported === "failed" ? strings.export.failed : plural(strings.export.done, exported)}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          narrow
          title={strings.sync.offTitle}
          body={strings.sync.offBody}
          confirmLabel={strings.sync.offConfirm}
          busyLabel={strings.sync.offBusy}
          cancelLabel={strings.sync.offCancel}
          busy={switching}
          trouble={
            offFailed && (
              <p className="dialog__bar" role="alert">
                <Icon name="cloud_off" className="dialog__bar-icon" />
                {strings.sync.offFailed}
              </p>
            )
          }
          onConfirm={() => turn(false)}
          onCancel={close}
        />
      )}
    </section>
  );
}
