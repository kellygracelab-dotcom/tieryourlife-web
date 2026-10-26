import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import {
  FaceSection,
  type Face,
  type LoadLists,
  type MakeFace,
  type UploadFace,
} from "../features/account/FaceSection";
import { LanguageCard } from "../features/account/LanguageCard";
import { NameSection, type Rename } from "../features/account/NameSection";
import type { Publish } from "../features/account/useSaving";
import { DataCard } from "../features/boards/DataCard";
import { AccountTabs } from "../app/AccountTabs";
import { useHidden } from "../features/community/useHidden";
import { useSession } from "../app/session";
import { ThemeSwitch } from "../app/ThemeSwitch";
import {
  eraseMyAccount,
  loadMyLists,
  makeFace as makeFaceOf,
  refreshPublishedAuthor,
} from "../lib/api";
import { uploadPicture } from "../lib/pictures";
import { renameAccount, setFace } from "../lib/profile";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { InAppNote } from "../ui/InAppNote";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import "./SettingsPage.css";

export type { Face, LoadLists, MakeFace, UploadFace } from "../features/account/FaceSection";
export type { Rename } from "../features/account/NameSection";
export type RefreshAuthor = () => Promise<unknown>;
export type Erase = () => Promise<void>;

interface SettingsPageProps {
  load?: LoadLists;
  rename?: Rename;
  face?: Face;
  upload?: UploadFace;
  makeFace?: MakeFace;
  refreshAuthor?: RefreshAuthor;
  erase?: Erase;
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
  upload = (file) => uploadPicture(file),
  makeFace = makeFaceOf,
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
            upload={upload}
            makeFace={makeFace}
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
