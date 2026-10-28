import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { ReportReason } from "../api/community";
import { errorOf, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { useSession } from "../app/session";
import type { BoardsRepository } from "../features/boards/repository";
import { SaveToMineDialog } from "../features/boards/SaveToMineDialog";
import { useSaveToMine, type SaveToMine } from "../features/boards/useSaveToMine";
import { ReportDialog, type ReportState } from "../features/community/ReportDialog";
import { useHidden } from "../features/community/useHidden";
import { report as sendReport, unpublish as unpublishList } from "../lib/api";
import { isEditorial } from "../lib/editorial";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import type { SnackbarNotice } from "../ui/Snackbar";
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
  // The phone's own share sheet, where there is one; closing it is not a failure.
  const canShare = typeof navigator.share === "function";
  const share = () => {
    void navigator.share({ title: list.title, url: link }).catch(() => undefined);
  };
  return { copy, canShare, share };
}

/**
 * One press and the link is on the clipboard. The address itself used to be
 * spelled out here, forty characters nobody reads and everybody had to select.
 */
function CopyLinkButton({ list }: { list: PublishedList }) {
  const { copy } = useListLink(list);
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
          () => undefined,
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
  const { copy, canShare, share } = useListLink(list);
  return (
    <>
      <li>
        <button
          type="button"
          className="menu__action"
          onClick={() => {
            copy().then(
              () => notify({ text: strings.list.linkCopied }),
              () => undefined,
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
 * What a visitor can do about a list besides ranking it, in the app's order:
 * see who made it, pass it on, keep it out of sight, complain. Reporting
 * needs an account, so a guest is asked to sign in first; hiding is this
 * device's business alone. Hiding everything from the author lives on their
 * page and in the report's receipt, as in the app.
 */
function VisitorMenu({
  list,
  report,
  notify,
  saving,
}: {
  list: PublishedList;
  report: Report;
  notify: Notify;
  saving: SaveToMine;
}) {
  const { account, signIn } = useSession();
  const { hideList, showList, hideAuthor } = useHidden();
  const [reporting, setReporting] = useState<ReportState>("closed");
  // An editorial list has no author to show, and a snapshot without the uid no page to show them on.
  const author = isEditorial(list) || list.authorUid === "" ? null : list;

  const hideNow = () => {
    hideList({ id: list.id, title: list.title });
    notify({
      text: strings.list.hiddenNotice,
      action: { text: strings.list.undo, onClick: () => showList(list.id) },
    });
  };

  const onSignIn = () => {
    setReporting("signingIn");
    signIn().then((outcome) => setReporting(outcome.kind === "signedIn" ? "open" : "signIn"));
  };

  const send = (reason: ReportReason, note: string | null, alsoAuthor: boolean) => {
    setReporting("sending");
    report(list.id, { reason, note }).then(
      () => {
        hideList({ id: list.id, title: list.title });
        if (alsoAuthor) hideAuthor({ uid: list.authorUid, name: list.authorName });
        setReporting("sent");
      },
      () => setReporting("failed"),
    );
  };

  const closeReport = useCallback(() => setReporting("closed"), []);

  return (
    <>
      <Menu label={strings.list.more} button={<Icon name="more_vert" />}>
        <>
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
              {strings.list.saveToMine}
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
              onClick={() => setReporting(account?.kind === "signedIn" ? "open" : "signIn")}
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
      <ReportDialog
        state={reporting}
        authorName={author === null ? null : author.authorName}
        send={send}
        onSignIn={onSignIn}
        onHideInstead={() => {
          setReporting("closed");
          hideNow();
        }}
        onHideAuthor={() => {
          setReporting("closed");
          hideAuthor({ uid: list.authorUid, name: list.authorName });
        }}
        onClose={closeReport}
      />
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
}: {
  list: PublishedList;
  report: Report;
  notify: Notify;
  repository?: BoardsRepository;
}) {
  const saving = useSaveToMine(list, notify, { repository });
  return (
    <>
      <Button variant="tonal" icon="bookmark" className="list-head__save" onClick={saving.start}>
        {strings.list.saveToMine}
      </Button>
      <CopyLinkButton list={list} />
      <VisitorMenu list={list} report={report} notify={notify} saving={saving} />
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
 * The author's own menu: the link, and taking the list down. A list made on
 * the site has no other copy, so taking it down is deleting it, and the word
 * says so; a board on the phone is the phone's and stays. "Publish as my
 * list", the owner's other line elsewhere, has nothing to do on one's own list.
 */
function AuthorMenu({
  list,
  unpublish,
  notify,
}: {
  list: PublishedList;
  unpublish: Unpublish;
  notify: Notify;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<Deleting>({ status: "closed" });
  const busy = deleting.status === "busy";

  const gone = () => void navigate("/me");
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
          <LinkItems list={list} notify={notify} />
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

/** The author's head: Edit for the board the list is changed on, the link, the menu. */
export function AuthorTools({
  list,
  unpublish,
  notify,
}: {
  list: PublishedList;
  unpublish: Unpublish;
  notify: Notify;
}) {
  return (
    <>
      <Link className="btn btn--tonal" to={`/b/new?list=${encodeURIComponent(list.id)}`}>
        <Icon name="edit" className="btn__icon" />
        <span>{strings.list.edit}</span>
      </Link>
      <CopyLinkButton list={list} />
      <AuthorMenu list={list} unpublish={unpublish} notify={notify} />
    </>
  );
}
