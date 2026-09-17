import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { ReportReason } from "../api/community";
import type { ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { useSession } from "../app/session";
import { arrange } from "../features/board/arrange";
import { RankingBoard } from "../features/board/RankingBoard";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { isAuthorHidden, isOutOfSight } from "../features/community/hidden";
import { ReportDialog, type ReportState } from "../features/community/ReportDialog";
import { useHidden } from "../features/community/useHidden";
import { useList } from "../features/list/useList";
import { report as sendReport } from "../lib/api";
import { fill, plural, strings } from "../strings";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
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

type View = "yours" | "authors";

export type Report = typeof sendReport;

/**
 * What a visitor can do about a list besides ranking it: complain, keep it
 * out of sight, or copy its link. Reporting needs an account, so a guest is
 * asked to sign in first; hiding is this device's business alone.
 */
function ListMenu({
  list,
  report,
  notify,
}: {
  list: PublishedList;
  report: Report;
  notify: (notice: SnackbarNotice) => void;
}) {
  const { account, signIn } = useSession();
  const { hideList, showList, hideAuthor } = useHidden();
  const [reporting, setReporting] = useState<ReportState>("closed");
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (menu.current !== null) menu.current.open = false;
  };

  const hideNow = () => {
    hideList({ id: list.id, title: list.title });
    notify({
      text: strings.list.hiddenNotice,
      action: { text: strings.list.undo, onClick: () => showList(list.id) },
    });
  };

  const copyLink = () => {
    close();
    const link = `${window.location.origin}/l/${encodeURIComponent(list.id)}`;
    void navigator.clipboard?.writeText(link).then(
      () => notify({ text: strings.list.linkCopied }),
      () => undefined,
    );
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
      <details className="menu" ref={menu}>
        <summary className="menu__button" aria-label={strings.list.more}>
          <Icon name="more_vert" />
        </summary>
        <ul className="menu__list">
          <li>
            <button
              type="button"
              className="menu__action"
              onClick={() => {
                close();
                setReporting(account?.kind === "signedIn" ? "open" : "signIn");
              }}
            >
              {strings.list.report}
            </button>
          </li>
          <li>
            <button
              type="button"
              className="menu__action"
              onClick={() => {
                close();
                hideNow();
              }}
            >
              {strings.list.hide}
            </button>
          </li>
          <li className="menu__divider" role="separator" />
          <li>
            <button type="button" className="menu__action" onClick={copyLink}>
              {strings.list.copyLink}
            </button>
          </li>
        </ul>
      </details>
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

export function ListPage({ report = sendReport }: { report?: Report }) {
  const { id = "" } = useParams();
  const { state, retry } = useList(id);
  const [view, setView] = useState<View>("yours");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const { hidden } = useHidden();

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Trouble error={state.error} retry={retry} />;

  const { list } = state;
  const address = `${window.location.host}/l/${id}`;
  const outOfSight = isOutOfSight(hidden, list);
  return (
    <article className="list-page">
      <header className="list-head">
        <div className="list-head__text">
          <h1 className="list-head__title">{list.title}</h1>
          <p className="list-head__meta">
            <Link
              to={`/u/${encodeURIComponent(list.authorUid)}`}
              state={{ author: { name: list.authorName, photoUrl: list.authorPhotoUrl } }}
            >
              {fill(strings.list.by, { name: list.authorName })}
            </Link>
            {" · "}
            {strings.rank.ownCopy}
            {" · "}
            {plural(strings.card.rankings, list.takeCount)}
          </p>
        </div>
        <span className="list-head__tools">
          <span className="list-head__address">
            <Icon name="link" />
            {address}
          </span>
          <ListMenu list={list} report={report} notify={setNotice} />
        </span>
      </header>
      {outOfSight && <HiddenView list={list} />}
      {!outOfSight && (
        <>
          <div className="list-page__views" role="group" aria-label={strings.list.views}>
            <Chip selected={view === "yours"} onClick={() => setView("yours")}>
              {strings.rank.yours}
            </Chip>
            <Chip selected={view === "authors"} onClick={() => setView("authors")}>
              {strings.board.authorsVersion}
            </Chip>
          </div>
          {view === "yours" ? (
            <RankingBoard key={list.id} list={list} />
          ) : (
            <ReadOnlyBoard
              label={strings.board.authorsVersion}
              tiers={list.tiers}
              items={list.items}
              {...arrange(list)}
            />
          )}
        </>
      )}
      <p className="list-page__foot">
        <Link to="/">{strings.list.home}</Link>
      </p>
      <Snackbar notice={notice} onDone={clearNotice} />
    </article>
  );
}
