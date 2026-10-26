import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { ListSummary } from "../api/types";
import { LanguageCard } from "../features/account/LanguageCard";
import { faceChoicesOf } from "../features/account/faces";
import { AccountTabs } from "../app/AccountTabs";
import { useBoardSync } from "../features/boards/boardSync";
import { exportText } from "../features/boards/exportText";
import { trashEntriesOf } from "../features/boards/model";
import { useBoards } from "../features/boards/useBoards";
import { useHidden } from "../features/community/useHidden";
import { useSession } from "../app/session";
import { ThemeSwitch } from "../app/ThemeSwitch";
import { useResource } from "../lib/useResource";
import { eraseMyAccount, loadMyLists, refreshPublishedAuthor } from "../lib/api";
import { NAME_MAX, renameAccount, setFace, tidyName } from "../lib/profile";
import { currentLocale, fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { InAppNote } from "../ui/InAppNote";
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
  const nothing = hidden.lists.length === 0 && hidden.authors.length === 0;
  return (
    <section className="settings__card" aria-labelledby="hidden-title">
      <h2 id="hidden-title" className="settings__title">
        {strings.settings.hiddenTitle}
      </h2>
      {nothing ? (
        // The app keeps the entry with an empty state, so the place is known before it is needed.
        <>
          <p className="settings__helper settings__helper--lead">
            {strings.settings.hiddenEmptyTitle}
          </p>
          <p className="settings__helper">{strings.settings.hiddenEmptyBody}</p>
        </>
      ) : (
        <p className="settings__helper">{strings.settings.hiddenBody}</p>
      )}
      {!nothing && (
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
      )}
    </section>
  );
}

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
/** The listing as a file the browser saves; the words are the page's language. */
export function saveExport(
  boards: Parameters<typeof exportText>[0],
  save: (name: string, text: string) => void = downloadText,
): number {
  const live = boards.filter((board) => board.deletedAt === null);
  const today = new Date();
  const text = exportText(live, {
    header: strings.brand,
    exportedOn: fill(strings.export.exportedOn, {
      date: new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(today),
    }),
    listCount: (n) => plural(strings.boards.count, n),
    rankedCount: (n) => plural(strings.boards.ranked, n),
    unrankedCount: (n) => plural(strings.boards.inPool, n),
    tierWithCaption: (label, caption) => `${label} — ${caption}`,
    tierPlain: (label) => label,
    tierEmpty: strings.export.tierEmpty,
    unrankedHeading: strings.export.unranked,
  });
  save(fill(strings.export.fileName, { date: today.toISOString().slice(0, 10) }), text);
  return live.length;
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataCard() {
  const sync = useBoardSync();
  const boards = useBoards();
  const trashed = trashEntriesOf(boards).length;
  const [asking, setAsking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [exported, setExported] = useState<number | "failed" | null>(null);
  const close = useCallback(() => setAsking(false), []);
  const onExport = () => {
    try {
      setExported(saveExport(boards));
    } catch {
      setExported("failed");
    }
  };
  const turn = (on: boolean) => {
    setAsking(false);
    setSwitching(true);
    void sync.setBackUp(on).finally(() => setSwitching(false));
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
          cancelLabel={strings.sync.offCancel}
          onConfirm={() => turn(false)}
          onCancel={close}
        />
      )}
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
  if (state === "closed") return null;
  return (
    <ConfirmDialog
      title={strings.settings.deleteTitle}
      body={strings.settings.deleteBody}
      confirmLabel={strings.settings.deleteConfirm}
      busyLabel={strings.settings.deleting}
      cancelLabel={strings.settings.cancel}
      busy={state === "busy"}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
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

      {account === null && (
        // The guest card's shape while Firebase says who is here: it arrives some
        // 400 ms after the first paint, and a bare line in its place let the cards
        // below jump 200 px when it came (WebKit's click landed on the wrong one).
        <section className="settings__card settings__card--guest" aria-busy="true">
          <Skeleton height="34px" width="34px" />
          <Skeleton height="26px" width="70%" />
          <Skeleton height="44px" width="90%" />
          <Skeleton height="40px" width="200px" />
        </section>
      )}

      {account?.kind === "guest" && (
        <section className="settings__card settings__card--guest">
          <Icon name="settings" className="settings__guest-icon" />
          <p className="settings__guest-title">{strings.settings.guestTitle}</p>
          <p className="settings__helper">{strings.settings.guestBody}</p>
          <InAppNote />
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
      <LanguageCard />
      <DataCard />
      <HiddenCard />
      <PrivacyCard />

      {account?.kind === "signedIn" && (
        <LeaveCard onSignOut={() => void signOut()} erase={erase} onErased={onErased} />
      )}
    </div>
  );
}
