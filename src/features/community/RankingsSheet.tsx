import { MediaImage } from "../../ui/MediaImage";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReaderRanking } from "../../api/community";
import type { PublishedList } from "../../api/types";
import { isEditorial } from "../../lib/editorial";
import { currentLocale, fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { useModal } from "../../ui/useModal";
import { useSession } from "../../app/session";
import { searchAgainAt } from "../../lib/searchLimit";
import { placedOn, readerName } from "./rankings";
import type { LikeTrouble, Rankings } from "./useRankings";
import { initialOf } from "../../lib/initial";
import "./rankings.css";

interface RankingsSheetProps {
  list: PublishedList;
  rankings: Rankings;
  /** Whose placing the left half of the switch shows: a reader's uid, or null for the author's. */
  chosen: string | null;
  onChoose: (ranking: ReaderRanking | null) => void;
  onWithdraw: () => void;
  onClose: () => void;
}

/** A photo, or the name's letter when there is none or it does not load: Google's links expire. */
function Face({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  return photoUrl !== null && photoUrl.trim() !== "" && !broken ? (
    <MediaImage
      className="rankings__face"
      src={photoUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="rankings__face rankings__face--initial" aria-hidden="true">
      {name === null ? <Icon name="person" /> : initialOf(name)}
    </span>
  );
}

interface RowProps {
  /** Null for a reader with no name, who is "Someone" in the reader's language. */
  name: string | null;
  photoUrl: string | null;
  /** The day it was placed; nothing for a date the backend never wrote. */
  when: number;
  selected: boolean;
  onClick: () => void;
  pill?: string;
  /** Beside the row, never inside its button: a second press of its own. */
  trailing?: ReactNode;
}

function Row({ name, photoUrl, when, selected, onClick, pill, trailing }: RowProps) {
  return (
    <li className="rankings__item">
      <button
        type="button"
        className="rankings__row"
        aria-current={selected ? "true" : undefined}
        onClick={onClick}
      >
        <Face name={name} photoUrl={photoUrl} />
        <span className="rankings__text">
          <span className="rankings__name">
            <bdi className="rankings__name-text">{name ?? strings.profile.someone}</bdi>
            {pill !== undefined && <span className="rankings__pill">{pill}</span>}
          </span>
          {when > 0 && <span className="rankings__when">{placedOn(when)}</span>}
        </span>
        {selected && <Icon name="check" className="rankings__check" />}
      </button>
      {trailing}
    </li>
  );
}

/**
 * The thumbs-up beside somebody's ranking (K2): pressed, it is liked; how many
 * others like it is never said. A toggle, so a screen reader hears its state.
 */
function LikeButton({
  name,
  liked,
  onPress,
}: {
  name: string | null;
  liked: boolean;
  onPress: () => void;
}) {
  const label =
    name === null ? strings.rankings.likeUnnamed : fill(strings.rankings.like, { name });
  return (
    <button
      type="button"
      className={liked ? "rankings__like rankings__like--on" : "rankings__like"}
      aria-pressed={liked}
      aria-label={label}
      title={label}
      onClick={onPress}
    >
      <Icon name="thumb_up" />
    </button>
  );
}

/** What a like that did not go through says, beside the ranking it was for. */
function likeTroubleText(trouble: LikeTrouble, now?: number): string {
  switch (trouble.kind) {
    case "signIn":
      return strings.rankings.likeSignIn;
    // A ban says what publishing says: the same moderator's decision.
    case "banned":
      return trouble.until === null
        ? strings.new.failedBanned
        : fill(strings.new.failedBannedUntil, {
            date: new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(
              trouble.until,
            ),
          });
    case "gone":
      return strings.rankings.likeGone;
    case "limit":
      return trouble.retryAt === null
        ? strings.rankings.likeLimitSoon
        : fill(strings.rankings.likeLimit, { time: searchAgainAt(trouble.retryAt, now) });
    case "failed":
      return strings.rankings.likeFailed;
  }
}

/** A guest's like: sign in first, offered where they pressed. */
function LikeSignIn({ onClose }: { onClose: () => void }) {
  const { signIn } = useSession();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <li className="rankings__ask rankings__ask--sign-in" role="group" aria-labelledby={titleId}>
      <p id={titleId} className="rankings__ask-title">
        {strings.rankings.likeSignIn}
      </p>
      {failed && (
        <p className="rankings__trouble" role="alert">
          {strings.nav.signInFailed}
        </p>
      )}
      <div className="rankings__ask-actions">
        <button type="button" className="btn btn--text" disabled={busy} onClick={onClose}>
          <span>{strings.rankings.progressLater}</span>
        </button>
        <button
          type="button"
          className="btn btn--tonal"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailed(false);
            void signIn().then((outcome) => {
              setBusy(false);
              if (outcome.kind === "failed") setFailed(true);
              else onClose();
            });
          }}
        >
          <span>{strings.nav.signIn}</span>
        </button>
      </div>
    </li>
  );
}

/** "Withdraw your ranking?", asked where the button was, with Cancel taking the focus. */
function WithdrawAsk({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <li className="rankings__ask" role="group" aria-labelledby={titleId}>
      <p id={titleId} className="rankings__ask-title">
        {strings.rankings.withdrawTitle}
      </p>
      <p className="rankings__ask-body">{strings.rankings.withdrawBody}</p>
      <div className="rankings__ask-actions">
        <button ref={cancel} type="button" className="btn btn--text" onClick={onCancel}>
          <span>{strings.rankings.cancel}</span>
        </button>
        <button type="button" className="btn dialog__danger" onClick={onConfirm}>
          <span>{strings.rankings.withdraw}</span>
        </button>
      </div>
    </li>
  );
}

/**
 * The people who placed this list's cards their own way, in the backend's
 * order (K1): the author first, then the most liked, the newer first among
 * equals, this reader's own in its place with You. Choosing one shows their
 * placing on the board; everybody else's has a like beside it. A side sheet on a wide screen, a bottom sheet on a
 * narrow one; Escape, the cross and a press outside close it.
 */
export function RankingsSheet({
  list,
  rankings,
  chosen,
  onChoose,
  onWithdraw,
  onClose,
}: RankingsSheetProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const { state, open, more, like, askSignIn, dismissTrouble } = rankings;
  const { account } = useSession();
  const signedIn = account?.kind === "signedIn";
  // A list without an author has nobody to name in the first row.
  const editorial = isEditorial(list);
  const authorName = list.authorName.trim();
  const trouble = state.likeTrouble;

  useModal(box, onClose);
  // Read when the sheet first opens, and again after one's own was put where
  // only the backend knows its place; a list nobody opens the sheet of costs nothing.
  // A sheet opened again after a failed read tries once more by itself.
  useEffect(() => open(), [open]);
  const idle = state.status === "idle";
  useEffect(() => {
    if (idle) open();
  }, [idle, open]);
  // Opened again after choosing somebody further down, the sheet starts at them.
  useEffect(() => {
    box.current
      ?.querySelector<HTMLElement>(".rankings__row[aria-current]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, []);

  // Show more hands the focus to the first reader it brought, so the keyboard
  // reads on from there; after the last page the button is gone anyway.
  const firstNew = useRef<number | null>(null);
  const showMore = () => {
    firstNew.current = box.current?.querySelectorAll(".rankings__row").length ?? null;
    more();
  };
  const shown = state.rankings.length;
  const loadingMore = state.more === "loading";
  useEffect(() => {
    const at = firstNew.current;
    if (at === null || loadingMore) return;
    firstNew.current = null;
    box.current?.querySelectorAll<HTMLElement>(".rankings__row")[at]?.focus();
  }, [shown, loadingMore]);

  return createPortal(
    <div className="scrim rankings-scrim" onClick={onClose}>
      <div
        ref={box}
        className="rankings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rankings__head">
          <h2 id={titleId} className="rankings__title">
            {strings.rankings.title}
          </h2>
          <button
            type="button"
            className="rankings__close"
            aria-label={strings.rankings.close}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="rankings__body">{strings.rankings.body}</p>
        <ul className="rankings__rows">
          {/* The author's arrangement is the list's own, drawn from it; one
              without a name (an anonymous or editorial list) is just Author. */}
          <Row
            name={editorial || authorName === "" ? strings.rankings.author : list.authorName}
            photoUrl={editorial ? null : list.authorPhotoUrl}
            when={list.updatedAt}
            selected={chosen === null}
            pill={editorial || authorName === "" ? undefined : strings.rankings.author}
            onClick={() => onChoose(null)}
          />
          {state.rankings.map((ranking) => {
            const name = readerName(ranking.authorName);
            const gone = state.gone.includes(ranking.uid);
            const troubled = trouble !== null && trouble.uid === ranking.uid;
            return (
              <Fragment key={ranking.uid}>
                <Row
                  name={name}
                  photoUrl={ranking.authorPhotoUrl}
                  when={ranking.updatedAtMs}
                  selected={chosen === ranking.uid}
                  pill={ranking.mine ? strings.rankings.you : undefined}
                  onClick={() => onChoose(ranking)}
                  trailing={
                    ranking.mine ? (
                      !asking && (
                        <button
                          type="button"
                          className="btn rankings__withdraw"
                          onClick={() => setAsking(true)}
                        >
                          <span>{strings.rankings.withdraw}</span>
                        </button>
                      )
                    ) : gone ? null : (
                      <LikeButton
                        name={name}
                        liked={ranking.likedByMe === true}
                        onPress={() => (signedIn ? like(ranking.uid) : askSignIn(ranking.uid))}
                      />
                    )
                  }
                />
                {/* Said beside the row that came back, not under a long list of readers. */}
                {ranking.mine && state.withdrawFailed && (
                  <li>
                    <p className="rankings__trouble" role="alert">
                      {strings.rankings.withdrawFailed}
                    </p>
                  </li>
                )}
                {ranking.mine && asking && (
                  <WithdrawAsk
                    onCancel={() => setAsking(false)}
                    onConfirm={() => {
                      setAsking(false);
                      onWithdraw();
                    }}
                  />
                )}
                {troubled &&
                  (trouble.kind === "signIn" ? (
                    <LikeSignIn onClose={dismissTrouble} />
                  ) : (
                    <li>
                      <p className="rankings__trouble" role="alert">
                        {likeTroubleText(trouble)}
                      </p>
                    </li>
                  ))}
              </Fragment>
            );
          })}
        </ul>
        {state.status === "loading" && (
          <div className="rankings__waiting" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height="40px" className="rankings__skeleton" />
            ))}
          </div>
        )}
        {state.status === "failed" && (
          <div className="rankings__foot">
            <p className="rankings__trouble" role="alert">
              {strings.rankings.failed}
            </p>
            <Button variant="tonal" icon="refresh" onClick={open}>
              {strings.list.tryAgain}
            </Button>
          </div>
        )}
        {state.status === "ready" && state.next !== null && (
          <div className="rankings__foot">
            {state.more === "failed" && (
              <p className="rankings__trouble" role="alert">
                {strings.feed.moreFailed}
              </p>
            )}
            {/* Not disabled while it loads: a disabled button drops the focus to the page. */}
            <button
              type="button"
              className="btn btn--tonal"
              aria-disabled={state.more === "loading"}
              onClick={state.more === "loading" ? undefined : showMore}
            >
              <span>{state.more === "loading" ? strings.feed.loadingMore : strings.feed.more}</span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
