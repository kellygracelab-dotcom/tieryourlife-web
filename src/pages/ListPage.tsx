import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ReportReason } from "../api/community";
import type { ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { PageTitle } from "../app/pageTitle";
import { useSession } from "../app/session";
import { arrange } from "../features/board/arrange";
import { RankingBoard } from "../features/board/RankingBoard";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { isAuthorHidden, isOutOfSight } from "../features/community/hidden";
import { ReportDialog, type ReportState } from "../features/community/ReportDialog";
import { useHidden } from "../features/community/useHidden";
import { useList } from "../features/list/useList";
import { errorOf } from "../features/list/useResource";
import { report as sendReport, unpublish as unpublishList } from "../lib/api";
import { fill, plural, strings } from "../strings";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { BoardFrameContext } from "../features/board/boardFrame";
import type { Dock } from "../features/board/dock";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import "../features/community/report.css";
import "./ListPage.css";

function Loading() {
  return (
    <div className="list-page" aria-busy="true">
      <Skeleton height="28px" width="60%" />
      <Skeleton height="18px" width="40%" />
      <Skeleton height="106px" className="list-page__row" />
      <Skeleton height="106px" className="list-page__row" />
      <Skeleton height="106px" className="list-page__row" />
      <p className="list-page__status">{strings.list.opening}</p>
    </div>
  );
}

function Trouble({ error, retry }: { error: ApiError; retry: () => void }) {
  const gone = error.kind === "notFound";
  if (gone) {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.list.unavailableTitle}</h1>
        <p>{strings.list.unavailableBody}</p>
        <Button variant="filled" href="/">
          {strings.list.home}
        </Button>
      </section>
    );
  }
  if (error.kind === "appUnverified") {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.list.unverifiedTitle}</h1>
        <p>{strings.list.unverifiedBody}</p>
      </section>
    );
  }
  const offline = error.kind === "offline";
  return (
    <section className="list-page list-page--trouble">
      <h1>{offline ? strings.list.offlineTitle : strings.list.failedTitle}</h1>
      <p>{offline ? strings.list.offlineBody : strings.list.failedBody}</p>
      <Button variant="filled" icon="refresh" onClick={retry}>
        {strings.list.tryAgain}
      </Button>
    </section>
  );
}

type View = "mine" | "theirs";

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

/** What the button does on a wide screen, the menu does on a phone, where the head has no room. */
function LinkItems({ list, notify }: { list: PublishedList; notify: Notify }) {
  const { copy, canShare, share } = useListLink(list);
  return (
    <>
      <li className="list-menu__copy">
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
 * What a visitor can do about a list besides ranking it: pass it on, complain,
 * or keep it, or everything from its author, out of sight. Reporting needs an
 * account, so a guest is asked to sign in first; hiding is this device's
 * business alone.
 */
function VisitorMenu({
  list,
  report,
  notify,
}: {
  list: PublishedList;
  report: Report;
  notify: Notify;
}) {
  const { account, signIn } = useSession();
  const { hideList, showList, hideAuthor, showAuthor } = useHidden();
  const [reporting, setReporting] = useState<ReportState>("closed");
  const { canShare } = useListLink(list);

  const hideNow = () => {
    hideList({ id: list.id, title: list.title });
    notify({
      text: strings.list.hiddenNotice,
      action: { text: strings.list.undo, onClick: () => showList(list.id) },
    });
  };

  const hideAuthorNow = () => {
    hideAuthor({ uid: list.authorUid, name: list.authorName });
    notify({
      text: fill(strings.list.hiddenAuthorNotice, { name: list.authorName }),
      action: { text: strings.list.undo, onClick: () => showAuthor(list.authorUid) },
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
          <LinkItems list={list} notify={notify} />
          <li
            className={canShare ? "menu__divider" : "menu__divider list-menu__copy"}
            role="separator"
          />
          <li>
            <button
              type="button"
              className="menu__action"
              onClick={() => setReporting(account?.kind === "signedIn" ? "open" : "signIn")}
            >
              {strings.list.report}
            </button>
          </li>
          <li>
            <button type="button" className="menu__action" onClick={hideNow}>
              {strings.list.hide}
            </button>
          </li>
          <li>
            <button type="button" className="menu__action" onClick={hideAuthorNow}>
              {fill(strings.list.hideAuthorNow, { name: list.authorName })}
            </button>
          </li>
        </>
      </Menu>
      <ReportDialog
        state={reporting}
        authorName={list.authorName}
        send={send}
        onSignIn={onSignIn}
        onHideInstead={() => {
          setReporting("closed");
          hideNow();
        }}
        onClose={closeReport}
      />
    </>
  );
}

type Deleting =
  | { status: "closed" }
  | { status: "asking" }
  | { status: "busy" }
  | { status: "failed"; error: ApiError };

/**
 * The author's own menu. A list made on the site has no other copy, so taking
 * it down is deleting it, and the word says so; a board on the phone is the
 * phone's and stays.
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
  const { canShare } = useListLink(list);
  const busy = deleting.status === "busy";

  const gone = () => void navigate("/me/lists");
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

  useEffect(() => {
    if (deleting.status === "closed" || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleting.status, busy, close]);

  return (
    <>
      <Menu label={strings.list.more} button={<Icon name="more_vert" />}>
        <>
          <LinkItems list={list} notify={notify} />
          <li
            className={canShare ? "menu__divider" : "menu__divider list-menu__copy"}
            role="separator"
          />
          <li>
            <Link to={`/new?list=${encodeURIComponent(list.id)}`}>{strings.list.edit}</Link>
          </li>
          <li>
            <button
              type="button"
              className="menu__action"
              onClick={() => setDeleting({ status: "asking" })}
            >
              {strings.list.delete}
            </button>
          </li>
        </>
      </Menu>
      {deleting.status !== "closed" && (
        <div className="scrim" onClick={busy ? undefined : close}>
          <div
            className="dialog dialog--narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-list-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-list-title" className="dialog__title">
              {strings.list.deleteTitle}
            </h2>
            <p className="dialog__body">{fill(strings.list.deleteBody, { title: list.title })}</p>
            {deleting.status === "failed" && (
              <p className="dialog__bar" role="alert">
                <Icon name="cloud_off" className="dialog__bar-icon" />
                {deleting.error.kind === "offline"
                  ? strings.list.deleteOffline
                  : strings.list.deleteFailed}
              </p>
            )}
            <div className="dialog__actions">
              <Button onClick={close} disabled={busy}>
                {strings.list.keepIt}
              </Button>
              <button
                type="button"
                className="btn dialog__danger"
                onClick={confirm}
                disabled={busy}
              >
                <span>{busy ? strings.list.deleting : strings.list.delete}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The page of a list this person hid: no board, a way back, a way home. */
function HiddenView({ list }: { list: PublishedList }) {
  const { hidden, showList, showAuthor } = useHidden();
  const byAuthor = isAuthorHidden(hidden, list.authorUid);
  return (
    <div className="list-page__hidden" role="status">
      <Icon name="visibility_off" className="list-page__hidden-icon" />
      <h2>
        {byAuthor
          ? fill(strings.list.hiddenAuthorTitle, { name: list.authorName })
          : strings.list.hiddenTitle}
      </h2>
      <p>{strings.list.hiddenBody}</p>
      <div className="list-page__hidden-actions">
        <Button
          variant="filled"
          onClick={() => {
            showList(list.id);
            if (byAuthor) showAuthor(list.authorUid);
          }}
        >
          {strings.list.unhide}
        </Button>
        <Link className="btn btn--tonal" to="/">
          <span>{strings.list.goHome}</span>
        </Link>
      </div>
    </div>
  );
}

interface ListPageProps {
  report?: Report;
  unpublish?: Unpublish;
}

export function ListPage({ report = sendReport, unpublish = unpublishList }: ListPageProps) {
  const { id = "" } = useParams();
  const { state, retry } = useList(id);
  const { account } = useSession();
  const [view, setView] = useState<View>("mine");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  // The shape the board took on a wide screen, so the header lays itself out
  // to match, and a place in the header for the bar while the pool is under.
  const [boardDock, setBoardDock] = useState<Dock | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const frame = useMemo(() => ({ headSlot, report: setBoardDock }), [headSlot]);
  const { hidden } = useHidden();

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Trouble error={state.error} retry={retry} />;

  const { list } = state;
  // The author has nobody's arrangement to compare with but their own: they
  // see the list as they published it, and the way to change it.
  const own = account?.kind === "signedIn" && account.uid === list.authorUid;
  const outOfSight = !own && isOutOfSight(hidden, list);
  const published = (
    <ReadOnlyBoard
      label={own ? strings.list.yourArrangement : strings.list.viewTheirs}
      tiers={list.tiers}
      items={list.items}
      {...arrange(list)}
    />
  );
  return (
    <article className={boardDock === null ? "list-page" : `list-page list-page--${boardDock}`}>
      <header className="list-head">
        <PageTitle title={list.title} />
        <div className="list-head__text">
          <h1 className="list-head__title">{list.title}</h1>
          <p className="list-head__meta">
            {list.authorUid === "" ? (
              // A snapshot without the uid has no author's page to lead to.
              fill(strings.list.by, { name: list.authorName })
            ) : (
              <Link
                to={`/u/${encodeURIComponent(list.authorUid)}`}
                state={{ author: { name: list.authorName, photoUrl: list.authorPhotoUrl } }}
              >
                {fill(strings.list.by, { name: list.authorName })}
              </Link>
            )}
            <span className="list-head__own">
              {" · "}
              {own ? strings.list.yourList : strings.rank.ownCopy}
            </span>
            {" · "}
            {plural(strings.card.rankings, list.takeCount)}
          </p>
        </div>
        {!outOfSight && !own && (
          <div className="list-page__views" role="group" aria-label={strings.list.views}>
            <Chip selected={view === "mine"} onClick={() => setView("mine")}>
              {strings.list.viewMine}
            </Chip>
            <Chip selected={view === "theirs"} onClick={() => setView("theirs")}>
              {strings.list.viewTheirs}
            </Chip>
          </div>
        )}
        <span className="list-head__tools">
          {own && (
            <Link className="btn btn--tonal" to={`/new?list=${encodeURIComponent(list.id)}`}>
              <Icon name="edit" className="btn__icon" />
              <span>{strings.list.edit}</span>
            </Link>
          )}
          <CopyLinkButton list={list} />
          {own ? (
            <AuthorMenu list={list} unpublish={unpublish} notify={setNotice} />
          ) : (
            <VisitorMenu list={list} report={report} notify={setNotice} />
          )}
        </span>
        <span className="list-head__bar" ref={setHeadSlot} />
      </header>
      {outOfSight && <HiddenView list={list} />}
      {!outOfSight && own && published}
      {!outOfSight &&
        !own &&
        (view === "mine" ? (
          <BoardFrameContext.Provider value={frame}>
            <RankingBoard key={list.id} list={list} />
          </BoardFrameContext.Provider>
        ) : (
          published
        ))}
      <Snackbar notice={notice} onDone={clearNotice} />
    </article>
  );
}
