import { type FormEvent, useState } from "react";
import { NAME_MAX, tidyName } from "../../lib/profile";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { SavedLine } from "./SavedLine";
import { type Publish, useSaving } from "./useSaving";

export type Rename = (name: string) => Promise<string>;

export function NameSection({
  current,
  rename,
  publish,
}: {
  current: string | null;
  rename: Rename;
  publish: Publish;
}) {
  // A Google name longer than the app allows starts cut to it, as on the phone.
  const kept = (current ?? "").slice(0, NAME_MAX);
  const [typed, setTyped] = useState(kept);
  const [saving, setSaving] = useSaving();
  const tidy = tidyName(typed);
  const empty = tidy.length === 0;
  const changed = tidy !== (current ?? "");
  const busy = saving.status === "busy";

  const save = () => {
    if (empty || !changed) return;
    setSaving({ status: "busy" });
    rename(tidy).then(
      async (saved) => {
        setTyped(saved);
        setSaving({ status: "saved", publishing: true });
        await publish();
        setSaving({ status: "saved", publishing: false });
      },
      () => setSaving({ status: "failed" }),
    );
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  return (
    <section className="settings__card" aria-labelledby="name-title">
      <h2 id="name-title" className="settings__title">
        {strings.settings.nameTitle}
      </h2>
      <p className="settings__helper">{strings.settings.nameBody}</p>
      <form className="settings__form" onSubmit={onSubmit}>
        <label className="settings__label" htmlFor="settings-name">
          {strings.settings.nameField}
        </label>
        <input
          id="settings-name"
          className="settings__input"
          type="text"
          value={typed}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          onChange={(event) => setTyped(event.target.value)}
        />
        <p
          className={
            typed.length >= NAME_MAX
              ? "settings__counter settings__counter--full"
              : "settings__counter"
          }
          aria-hidden="true"
        >
          {fill(strings.settings.nameCounter, { n: typed.length, max: NAME_MAX })}
        </p>
        {empty && <p className="settings__problem">{strings.settings.nameNeeded}</p>}
        <div className="settings__actions">
          <Button variant="filled" type="submit" disabled={empty || !changed || busy}>
            {busy ? strings.settings.saving : strings.settings.save}
          </Button>
          {typed !== kept && !busy && (
            <Button
              onClick={() => {
                setTyped(kept);
                setSaving({ status: "idle" });
              }}
            >
              {strings.settings.cancel}
            </Button>
          )}
        </div>
        {saving.status === "failed" && (
          <p className="settings__error" role="alert">
            <Icon name="cloud_off" className="settings__error-icon" />
            {strings.settings.nameFailed}
            <button type="button" className="settings__retry" onClick={save}>
              {strings.settings.tryAgain}
            </button>
          </p>
        )}
        <SavedLine state={saving} />
      </form>
      <p className="settings__note">{strings.settings.nameNote}</p>
    </section>
  );
}
