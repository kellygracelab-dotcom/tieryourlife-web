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
 * A run that did not go through says so once a day has gone by without one
 * that did, as on the phone: a failure the next run mends is not worth an
 * alarm. A connection gone or a busy server look alike from here, so the
 * note names neither. A board the account will not keep as it is, too big
 * or one too many, no run mends: that one is named at once, with what would
 * let it go up, instead of a "try again" that cannot help.
 */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The phone's "Your data": whether the boards are kept in the account, the
 * trash with its count. Switching the backup off deletes the account's copy,
 * so it asks first.
 */
export function DataCard({ now = Date.now }: { now?: () => number }) {
  const sync = useBoardSync();
  // Back up now pressed: whatever it came to is said at once.
  const [pressed, setPressed] = useState(false);
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
              {sync.refusals.map((refusal) => (
                <p key={refusal.uid} className="settings__bar" role="alert">
                  {fill(
                    refusal.why === "tooLarge"
                      ? strings.sync.refusedTooLarge
                      : strings.sync.refusedTooMany,
                    { title: refusal.title },
                  )}
                </p>
              ))}
              {sync.status === "stuck" &&
                sync.refusals.length === 0 &&
                (pressed ||
                  sync.lastSyncedAt === null ||
                  now() - sync.lastSyncedAt >= STUCK_AFTER_MS) && (
                  <p className="settings__bar" role="alert">
                    {sync.lastSyncedAt === null
                      ? strings.sync.stuckNever
                      : fill(strings.sync.stuck, { when: whenOf(sync.lastSyncedAt) })}
                  </p>
                )}
              <div className="settings__actions">
                <Button
                  icon="cloud_upload"
                  onClick={() => {
                    setPressed(true);
                    void sync.syncNow();
                  }}
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
