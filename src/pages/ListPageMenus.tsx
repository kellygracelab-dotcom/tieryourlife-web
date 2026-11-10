import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { errorOf, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { boards as site } from "../features/boards/owners";
import type { BoardsRepository } from "../features/boards/repository";
import { forgetPublished } from "../features/boards/takeDown";
import { SaveToMineDialog } from "../features/boards/SaveToMineDialog";
import {
  useSaveToMine,
  type SaveToMine,
  type ShownPlacing,
} from "../features/boards/useSaveToMine";
import { useHidden } from "../features/community/useHidden";
import { useReporting } from "../features/community/useReporting";
import { report as sendReport, unpublish as unpublishList } from "../lib/api";
import { isEditorial } from "../lib/editorial";
import { fill, formatCount, strings } from "../strings";
import { Button } from "../ui/Button";
import { ResetPoolItem } from "../features/tierboard/ResetPoolItem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import type { SnackbarNotice } from "../ui/Snackbar";
import { useLeave } from "../ui/useLeave";
import "../features/community/report.css";
import "./ListPage.css";

export type Report = typeof sendReport;
export type Unpublish = typeof unpublishList;

type Notify = (notice: SnackbarNotice) => void;

/** The list's address, and the two ways to hand it to someone. */
function useListLink(list: PublishedList) {
  const link = `${window.location.origin}/l/${encodeURIComponent(list.id)}`;
  const copy = (): Promise<void> =>
    navigator.clipboard?.writeText(link) ?? Promise.reject(new Error("no clipboard"));
  // The clipboard said no: the link is spelled out, to be copied by hand.
  const refused = (): SnackbarNotice => ({ text: fill(strings.list.copyFailed, { link }) });
  // The phone's own share sheet, where there is one; closing it is not a failure.
  const canShare = typeof navigator.share === "function";
  const share = () => {
    void navigator.share({ title: list.title, url: link }).catch(() => undefined);
  };
  return { copy, refused, canShare, share };
}

/**
 * One press and the link is on the clipboard. The address itself used to be
 * spelled out here, forty characters nobody reads and everybody had to select.
 */
function CopyLinkButton({ list, notify }: { list: PublishedList; notify: Notify }) {
  const { copy, refused } = useListLink(list);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="list-head__copy"
      onClick={() => {
        copy().then(
          () => setCopied(true),
          () => notify(refused()),
        );
      }}
    >
      <Icon name={copied ? "check" : "link"} />
      <span aria-live="polite">{copied ? strings.list.linkCopied : strings.list.copyLink}</span>
    </button>
  );
}

/**
 * Copy link, which the head's chip does too, and the device's own share sheet
 * where there is one: the web's way to hand a list on, which the app's
 * menu has no need of.
 */
function LinkItems({ list, notify }: { list: PublishedList; notify: Notify }) {
  const { copy, refused, canShare, share } = useListLink(list);
  return (
    <>
      <li>
        <button
          type="button"
          className="menu__action"
          onClick={() => {
            copy().then(
              () => notify({ text: strings.list.linkCopied }),
              () => notify(refused()),
            );
          }}
        >
          {strings.list.copyLink}
        </button>
      </li>
      {canShare && (
        <li>
          <button type="button" className="menu__action" onClick={share}>
            {strings.list.share}
          </button>
        </li>
      )}
    </>
  );
}

/**
 * Who else ranked the list, as the app's menu has it: "Rankings · N", the one
 * place the number is said (Danylo, 01.11.2026), opening the sheet of them.
 */
export interface RankingsEntry {
  count: number;
  open: () => void;
}

function RankingsItem({ rankings }: { rankings: RankingsEntry | null }) {
  if (rankings === null) return null;
  return (
    <li>
      <button type="button" className="menu__action" aria-haspopup="dialog" onClick={rankings.open}>
        {`${strings.rankings.title} · ${formatCount(rankings.count)}`}
      </button>
    </li>
  );
}

/**
 * One's own arrangement among the list's public rankings, the app's "Show my
 * ranking to others": offered once Mine is arranged, to a guest as a way to
 * sign in first.
 */
export interface ShowMineEntry {
  signedIn: boolean;
  busy: boolean;
  show: () => void;
}

function ShowMineItem({ showMine }: { showMine: ShowMineEntry | null }) {
  if (showMine === null) return null;
  return (
    <li>
      <button
        type="button"
        className="menu__action"
        disabled={showMine.busy}
        onClick={showMine.show}
      >
        {showMine.signedIn ? strings.rankings.showMine : strings.rankings.signInToShow}
      </button>
    </li>
  );
}

/**
 * What a visitor can do about a list besides ranking it, in the app's order:
 * see who made it, pass it on, keep it out of sight, complain. A guest
 * reports too, with no sign-in; hiding is this device's business alone.
 * Either takes the list out of sight, and the page goes back to where it was
 * opened from, as the app's screen closes. Hiding everything from the author
 * lives on their page and in the report's receipt, as in the app.
 */
function VisitorMenu({
  list,
  report,
  notify,
  saving,
  rankings,
  showMine,
  resetMine,
}: {
  list: PublishedList;
  report: Report;
  notify: Notify;
  saving: SaveToMine;
  rankings: RankingsEntry | null;
  showMine: ShowMineEntry | null;
  resetMine?: (() => void) | null;
}) {
  const { hideList } = useHidden();
  const leave = useLeave();
  // An editorial list has no author to show, and a snapshot without the uid no page to show them on.
  const author = isEditorial(list) || list.authorUid === "" ? null : list;

  const hideNow = () => {
    hideList({ id: list.id, title: list.title });
    leave();
  };
  const reporting = useReporting({ report, notify, onDone: leave });

  return (
    <>
      <Menu label={strings.list.more} button={<Icon name="more_vert" />}>
        <>
          <RankingsItem rankings={rankings} />
          <ShowMineItem showMine={showMine} />
          {resetMine !== undefined && <ResetPoolItem onReset={resetMine} />}
          {author !== null && (
            <li>
              <Link
                to={`/u/${encodeURIComponent(author.authorUid)}`}
                state={{ author: { name: author.authorName, photoUrl: author.authorPhotoUrl } }}
              >
                {fill(strings.list.viewAuthor, { name: author.authorName })}
              </Link>
            </li>
          )}
          <LinkItems list={list} notify={notify} />
          {/* The head's own Save button, where a phone's head has no room for it. */}
          <li className="list-menu__narrow">
            <button type="button" className="menu__action" onClick={saving.start}>
              {saving.saved === null ? strings.list.saveToMine : strings.list.open}
            </button>
          </li>
          <li>
            <button type="button" className="menu__action" onClick={hideNow}>
              {strings.list.hide}
            </button>
          </li>
          <li className="menu__divider" role="separator" />
          <li>
            <button
              type="button"
              className="menu__action menu__action--danger"
              onClick={() => reporting.start(list)}
            >
              {strings.list.report}
            </button>
          </li>
          {/* The footer waits while the pool is docked, so the privacy policy ends the menu instead. */}
          <li>
            <a className="menu__action" href="/privacy.html">
              {strings.footer.privacy}
            </a>
          </li>
        </>
      </Menu>
      {reporting.dialog}
    </>
  );
}

/**
 * A visitor's head: the phone's "Save to my lists" as a button beside Copy
 * link, the menu with the rest. One saving flow serves the button and the
 * menu's copy of it.
 */
export function VisitorTools({
  list,
  report,
  notify,
  repository,
  rankings = null,
  shown = null,
  showMine = null,
  resetMine,
}: {
  list: PublishedList;
  report: Report;
  notify: Notify;
  repository?: BoardsRepository;
  rankings?: RankingsEntry | null;
  /** Mine among the list's rankings, once there is a Mine to show. */
  showMine?: ShowMineEntry | null;
  resetMine?: (() => void) | null;
  /** A reader's ranking on show in the left half, which Save then offers to keep. */
  shown?: ShownPlacing | null;
}) {
  const saving = useSaveToMine(list, notify, { repository, shown });
  return (
    <>
      <Button variant="tonal" icon="bookmark" className="list-head__save" onClick={saving.start}>
        {saving.saved === null ? strings.list.saveToMine : strings.list.open}
      </Button>
      <CopyLinkButton list={list} notify={notify} />
      <VisitorMenu
        list={list}
        report={report}
        notify={notify}
        saving={saving}
        rankings={rankings}
        showMine={showMine}
        resetMine={resetMine}
      />
      <SaveToMineDialog saving={saving} />
    </>
  );
}

type Deleting =
  | { status: "closed" }
  | { status: "asking" }
  | { status: "busy" }
  | { status: "failed"; error: ApiError };

/**
 * The author's own menu: the link, and taking the list down. The board it was
 * published from stays, here and on the phone, and is its own again. "Publish
 * as my list", the owner's other line elsewhere, has nothing to do on one's
 * own list.
 */
function AuthorMenu({
  list,
  unpublish,
  notify,
  rankings,
  repository,
}: {
  list: PublishedList;
  unpublish: Unpublish;
  notify: Notify;
  rankings: RankingsEntry | null;
  repository: BoardsRepository;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<Deleting>({ status: "closed" });
  const busy = deleting.status === "busy";

  // The list's page goes from the history with the list: Back from /me must
  // not show its author the apology meant for a visitor sent a dead link.
  const gone = () => {
    forgetPublished(list.id, repository, Date.now());
    void navigate("/me", { replace: true });
  };
  const confirm = () => {
    setDeleting({ status: "busy" });
    unpublish(list.id).then(gone, (reason: unknown) => {
      const error = errorOf(reason);
      // Already gone is what was asked for.
      if (error.kind === "notFound") gone();
      else setDeleting({ status: "failed", error });
    });
  };
  const close = useCallback(() => setDeleting({ status: "closed" }), []);

  return (
    <>
      <Menu label={strings.list.more} button={<Icon name="more_vert" />}>
        <>
          <RankingsItem rankings={rankings} />
          {/* Held, the link answers nobody else yet: it is not handed out. */}
          {list.underReview !== true && <LinkItems list={list} notify={notify} />}
          <li>
            <button
              type="button"
              className="menu__action menu__action--danger"
              onClick={() => setDeleting({ status: "asking" })}
            >
              {strings.list.delete}
            </button>
          </li>
        </>
      </Menu>
      {deleting.status !== "closed" && (
        <ConfirmDialog
          narrow
          title={strings.list.deleteTitle}
          body={fill(strings.list.deleteBody, { title: list.title })}
          confirmLabel={strings.list.delete}
          busyLabel={strings.list.deleting}
          cancelLabel={strings.list.keepIt}
          busy={busy}
          trouble={
            deleting.status === "failed" && (
              <p className="dialog__bar" role="alert">
                <Icon name="cloud_off" className="dialog__bar-icon" />
                {deleting.error.kind === "offline"
                  ? strings.list.deleteOffline
                  : strings.list.deleteFailed}
              </p>
            )
          }
          onConfirm={confirm}
          onCancel={close}
        />
      )}
    </>
  );
}

/**
 * The author's head: Edit for the board the list is changed on, the link, the
 * menu. A list held for a moderator has no link to give: it answers nobody
 * else until a moderator looks.
 */
export function AuthorTools({
  list,
  unpublish,
  notify,
  rankings = null,
  repository = site,
}: {
  list: PublishedList;
  unpublish: Unpublish;
  notify: Notify;
  rankings?: RankingsEntry | null;
  /** The boards one of which may have published the list. */
  repository?: BoardsRepository;
}) {
  return (
    <>
      <Link className="btn btn--tonal" to={`/b/new?list=${encodeURIComponent(list.id)}`}>
        <Icon name="edit" className="btn__icon" />
        <span>{strings.list.edit}</span>
      </Link>
      {list.underReview !== true && <CopyLinkButton list={list} notify={notify} />}
      <AuthorMenu
        list={list}
        unpublish={unpublish}
        notify={notify}
        rankings={rankings}
        repository={repository}
      />
    </>
  );
}
