import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReaderRanking } from "../../api/community";
import type { PublishedList } from "../../api/types";
import { isEditorial } from "../../lib/editorial";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { useModal } from "../../ui/useModal";
import { placedOn } from "./rankings";
import type { Rankings } from "./useRankings";
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

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

function Face({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  return photoUrl !== null ? (
    <img className="rankings__face" src={photoUrl} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="rankings__face rankings__face--initial" aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

interface RowProps {
  name: string;
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
            <span className="rankings__name-text">{name}</span>
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
 * The people who placed this list's cards their own way: the author first,
 * this reader next, everyone else newest first. Choosing one shows their
 * placing on the board. A side sheet on a wide screen, a bottom sheet on a
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
  const { state, open, more } = rankings;
  // A list without an author has nobody to name in the first row.
  const editorial = isEditorial(list);
  const mine = state.rankings.find((ranking) => ranking.mine);
  const others = state.rankings.filter((ranking) => !ranking.mine);

  useModal(box, onClose);
  // Read when the sheet first opens; a list nobody opens the sheet of costs nothing.
  useEffect(() => open(), [open]);

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
          <Row
            name={editorial ? strings.rankings.author : list.authorName}
            photoUrl={editorial ? null : list.authorPhotoUrl}
            when={list.updatedAt}
            selected={chosen === null}
            pill={editorial ? undefined : strings.rankings.author}
            onClick={() => onChoose(null)}
          />
          {mine !== undefined && (
            <Row
              name={strings.rankings.you}
              photoUrl={mine.authorPhotoUrl}
              when={mine.updatedAtMs}
              selected={chosen === mine.uid}
              onClick={() => onChoose(mine)}
              trailing={
                !asking && (
                  <button
                    type="button"
                    className="btn rankings__withdraw"
                    onClick={() => setAsking(true)}
                  >
                    <span>{strings.rankings.withdraw}</span>
                  </button>
                )
              }
            />
          )}
          {mine !== undefined && asking && (
            <WithdrawAsk
              onCancel={() => setAsking(false)}
              onConfirm={() => {
                setAsking(false);
                onWithdraw();
              }}
            />
          )}
          {others.map((ranking) => (
            <Row
              key={ranking.uid}
              name={ranking.authorName}
              photoUrl={ranking.authorPhotoUrl}
              when={ranking.updatedAtMs}
              selected={chosen === ranking.uid}
              onClick={() => onChoose(ranking)}
            />
          ))}
        </ul>
        {state.status === "loading" && (
          <div className="rankings__waiting" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height="40px" className="rankings__skeleton" />
            ))}
          </div>
        )}
        {state.withdrawFailed && (
          <p className="rankings__trouble" role="alert">
            {strings.rankings.withdrawFailed}
          </p>
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
            <Button variant="tonal" onClick={more} disabled={state.more === "loading"}>
              {state.more === "loading" ? strings.feed.loadingMore : strings.feed.more}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
