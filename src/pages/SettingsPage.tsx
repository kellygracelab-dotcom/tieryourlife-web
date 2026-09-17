import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { ListSummary } from "../api/types";
import { faceChoicesOf } from "../features/account/faces";
import { AccountTabs } from "../app/AccountTabs";
import { useHidden } from "../features/community/useHidden";
import { useSession } from "../app/session";
import { ThemeSwitch } from "../app/ThemeSwitch";
import { useResource } from "../features/list/useResource";
import { eraseMyAccount, loadMyLists, refreshPublishedAuthor } from "../lib/api";
import { NAME_MAX, renameAccount, setFace, tidyName } from "../lib/profile";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import "./SettingsPage.css";

export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Rename = (name: string) => Promise<string>;
export type Face = (photoUrl: string | null) => Promise<void>;
export type RefreshAuthor = () => Promise<unknown>;
export type Erase = () => Promise<void>;

interface SettingsPageProps {
  load?: LoadLists;
  rename?: Rename;
  face?: Face;
  refreshAuthor?: RefreshAuthor;
  erase?: Erase;
}

/** "Saved." stays this long. */
export const SAVED_NOTE_MS = 6000;
/** A caption longer than this would be an ellipsis under a 64 px face; the name goes in the tooltip. */
const CAPTION_MAX = 12;

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

type Saving =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "saved"; publishing: boolean }
  | { status: "failed" };

/**
 * A line for a moment after a change, then nothing, so the section rests.
 * "Saved" first says the published lists are being updated, then just "Saved."
 */
function useSaving(): [Saving, (next: Saving) => void] {
  const [state, setState] = useState<Saving>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback((next: Saving) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setState(next);
    if (next.status === "saved" && !next.publishing) {
      timer.current = setTimeout(() => setState({ status: "idle" }), SAVED_NOTE_MS);
    }
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return [state, set];
}

function SavedLine({ state }: { state: Saving }) {
  if (state.status !== "saved") return null;
  return (
    <p className="settings__saved" role="status">
      <Icon name="check" className="settings__saved-icon" />
      {state.publishing ? strings.settings.savedPublishing : strings.settings.saved}
    </p>
  );
}

/** A change on the profile, then the same change on every published list. */
type Publish = () => Promise<void>;

function NameSection({
  current,
  rename,
  publish,
}: {
  current: string | null;
  rename: Rename;
  publish: Publish;
}) {
  const [typed, setTyped] = useState(current ?? "");
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
          {typed !== (current ?? "") && !busy && (
            <Button
              onClick={() => {
                setTyped(current ?? "");
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

function FaceSection({
  uid,
  current,
  name,
  load,
  face,
  publish,
}: {
  uid: string;
  current: string | null;
  name: string | null;
  load: LoadLists;
  face: Face;
  publish: Publish;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state } = useResource(uid, loadFor);
  const [saving, setSaving] = useSaving();
  const choices = state.status === "ready" ? faceChoicesOf(state.value.lists) : [];
  const busy = saving.status === "busy";

  // The choice on show comes from the account, never from the click, so a
  // refused change snaps back by itself.
  const choose = (url: string | null) => {
    if (url === current || busy) return;
    setSaving({ status: "busy" });
    face(url).then(
      async () => {
        setSaving({ status: "saved", publishing: true });
        await publish();
        setSaving({ status: "saved", publishing: false });
      },
      () => setSaving({ status: "failed" }),
    );
  };

  return (
    <section className="settings__card" aria-labelledby="face-title">
      <h2 id="face-title" className="settings__title">
        {strings.settings.faceTitle}
      </h2>
      <p className="settings__helper">{strings.settings.faceBody}</p>
      <ul className="settings__faces" aria-label={strings.settings.faceChoices}>
        <li className="settings__face">
          <button
            type="button"
            className="settings__choice settings__choice--letter"
            aria-label={strings.settings.faceLetter}
            aria-pressed={current === null}
            onClick={() => choose(null)}
          >
            {initialOf(name)}
            {current === null && <Icon name="check" className="settings__choice-check" />}
          </button>
          <span className="settings__face-from">{strings.settings.faceLetterCaption}</span>
        </li>
        {choices.map((choice) => (
          <li key={choice.url} className="settings__face">
            <button
              type="button"
              className="settings__choice"
              aria-label={fill(strings.settings.faceChoice, { list: choice.from })}
              title={choice.from}
              aria-pressed={choice.url === current}
              onClick={() => choose(choice.url)}
            >
              <img src={choice.url} alt="" loading="lazy" />
              {choice.url === current && <Icon name="check" className="settings__choice-check" />}
            </button>
            {choice.from.length <= CAPTION_MAX && (
              <span className="settings__face-from">{choice.from}</span>
            )}
          </li>
        ))}
        {state.status === "loading" && (
          <li className="settings__face" aria-busy="true">
            <Skeleton height="64px" width="64px" className="settings__choice-placeholder" />
          </li>
        )}
      </ul>
      {state.status === "ready" && choices.length === 0 && (
        <p className="settings__helper">{strings.settings.faceNone}</p>
      )}
      {saving.status === "failed" && (
        <p className="settings__error" role="alert">
          <Icon name="cloud_off" className="settings__error-icon" />
          {strings.settings.faceFailed}
        </p>
      )}
      <SavedLine state={saving} />
    </section>
  );
}

function ThemeCard({ note }: { note: string | null }) {
  return (
    <section className="settings__card" aria-labelledby="theme-title">
      <h2 id="theme-title" className="settings__title">
        {strings.nav.theme}
      </h2>
      <ThemeSwitch />
      {note !== null && <p className="settings__note">{note}</p>}
    </section>
  );
}

function HiddenCard() {
  const { hidden, showList, showAuthor } = useHidden();
  if (hidden.lists.length === 0 && hidden.authors.length === 0) return null;
  return (
    <section className="settings__card" aria-labelledby="hidden-title">
      <h2 id="hidden-title" className="settings__title">
        {strings.settings.hiddenTitle}
      </h2>
      <p className="settings__helper">{strings.settings.hiddenBody}</p>
      <ul className="settings__hidden" aria-label={strings.settings.hiddenTitle}>
        {hidden.lists.map((list) => (
          <li key={`l-${list.id}`} className="settings__hidden-row">
            <span className="settings__hidden-name">{list.title}</span>
            <Button onClick={() => showList(list.id)}>{strings.settings.showAgain}</Button>
          </li>
        ))}
        {hidden.authors.map((author) => (
          <li key={`a-${author.uid}`} className="settings__hidden-row">
            <span className="settings__hidden-name">
              {fill(strings.settings.hiddenAuthor, { name: author.name })}
            </span>
            <Button onClick={() => showAuthor(author.uid)}>{strings.settings.showAgain}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrivacyCard() {
  return (
    <section className="settings__card" aria-labelledby="privacy-title">
      <h2 id="privacy-title" className="settings__title">
        {strings.settings.privacyTitle}
      </h2>
      <a className="settings__row" href="/privacy.html" target="_blank" rel="noopener">
        <span>{strings.footer.privacy}</span>
        <Icon name="open_in_new" className="settings__row-icon" />
      </a>
    </section>
  );
}

type Deleting = "closed" | "asking" | "busy";

function DeleteDialog({
  state,
  onConfirm,
  onCancel,
}: {
  state: Deleting;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const open = state !== "closed";
  const busy = state === "busy";

  // Cancel takes the focus, not the destructive button, for anybody who
  // pressed Enter before reading. While it is under way nothing dismisses it.
  useEffect(() => {
    if (!open) return;
    cancel.current?.focus();
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
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="delete-title" className="dialog__title">
          {strings.settings.deleteTitle}
        </h2>
        <p className="dialog__body">{strings.settings.deleteBody}</p>
        <div className="dialog__actions">
          <button
            ref={cancel}
            type="button"
            className="btn btn--text"
            onClick={onCancel}
            disabled={busy}
          >
            <span>{strings.settings.cancel}</span>
          </button>
          <button type="button" className="btn dialog__danger" onClick={onConfirm} disabled={busy}>
            <span>{busy ? strings.settings.deleting : strings.settings.deleteConfirm}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveCard({
  onSignOut,
  erase,
  onErased,
}: {
  onSignOut: () => void;
  erase: Erase;
  onErased: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<Deleting>("closed");
  const [failed, setFailed] = useState(false);
  const closeDelete = useCallback(() => setDeleting("closed"), []);

  const onDelete = () => {
    setDeleting("busy");
    setFailed(false);
    erase().then(
      () => onErased(),
      () => {
        setDeleting("closed");
        setFailed(true);
      },
    );
  };

  return (
    <section className="settings__card settings__card--leave" aria-labelledby="leave-title">
      {failed && (
        <p className="settings__bar" role="alert">
          {strings.settings.deleteFailed}
        </p>
      )}
      <h2 id="leave-title" className="settings__title">
        {strings.nav.signOut}
      </h2>
      <div className="settings__actions">
        <Button className="settings__signout" icon="logout" onClick={onSignOut}>
          {strings.nav.signOut}
        </Button>
      </div>
      <p className="settings__note">{strings.settings.signOutNote}</p>
      <hr className="settings__divider" />
      <h2 className="settings__title">{strings.settings.deleteAction}</h2>
      <p className="settings__helper">{strings.settings.deleteHelper}</p>
      <div className="settings__actions">
        <Button className="settings__delete" onClick={() => setDeleting("asking")}>
          {strings.settings.deleteAction}
        </Button>
      </div>
      <DeleteDialog state={deleting} onConfirm={onDelete} onCancel={closeDelete} />
    </section>
  );
}

export function SettingsPage({
  load = loadMyLists,
  rename = renameAccount,
  face = setFace,
  refreshAuthor = refreshPublishedAuthor,
  erase = eraseMyAccount,
}: SettingsPageProps) {
  const { account, signIn, signOut, refresh } = useSession();
  const navigate = useNavigate();

  // The lists the person already published carry the name and face they were
  // published with; the backend rewrites them from the fresh token. Best
  // effort: the profile itself is saved either way.
  const publish: Publish = async () => {
    refresh();
    await refreshAuthor().catch(() => undefined);
  };

  // The backend has removed the user already; this ends the session on this
  // device, brings a guest back and says so once on the front page.
  const onErased = async () => {
    await signOut().catch(() => undefined);
    await navigate("/", { state: { accountDeleted: true } });
  };

  return (
    <div className="settings">
      <h1 className="settings__heading">{strings.settings.title}</h1>
      {account?.kind === "signedIn" && <AccountTabs current="settings" />}

      {account === null && <Skeleton height="20px" width="40%" />}

      {account?.kind === "guest" && (
        <section className="settings__card settings__card--guest">
          <Icon name="settings" className="settings__guest-icon" />
          <p className="settings__guest-title">{strings.settings.guestTitle}</p>
          <p className="settings__helper">{strings.settings.guestBody}</p>
          <div>
            <Button variant="filled" onClick={() => void signIn()}>
              {strings.keep.google}
            </Button>
          </div>
        </section>
      )}

      {account?.kind === "signedIn" && (
        <>
          <NameSection
            key={account.uid}
            current={account.displayName}
            rename={rename}
            publish={publish}
          />
          <FaceSection
            uid={account.uid}
            current={account.photoUrl}
            name={account.displayName}
            load={load}
            face={face}
            publish={publish}
          />
        </>
      )}

      <ThemeCard note={account?.kind === "guest" ? strings.settings.themeGuestNote : null} />
      <HiddenCard />
      <PrivacyCard />

      {account?.kind === "signedIn" && (
        <LeaveCard onSignOut={() => void signOut()} erase={erase} onErased={onErased} />
      )}
    </div>
  );
}
