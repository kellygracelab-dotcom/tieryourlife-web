import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportReason } from "../api/community";
import { BAN_LENGTHS, type BanLength, type QueuedList } from "../api/moderation";
import { useSession } from "../app/session";
import { localStorageStore } from "../features/board/draft";
import { noteReports } from "../features/moderation/useModerator";
import { useResource } from "../features/list/useResource";
import { leaveListUp, loadReports, takeDownList } from "../lib/api";
import { agoText, reasonCounts } from "../features/moderation/queue";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./ModerationPage.css";

export type LoadQueue = () => Promise<{ reports: QueuedList[] }>;
export type TakeDown = (id: string, ban: BanLength | null) => Promise<void>;
export type LeaveUp = (id: string) => Promise<void>;

interface ModerationPageProps {
  load?: LoadQueue;
  takeDown?: TakeDown;
  leaveUp?: LeaveUp;
}

/** Notes shown before "Show N more notes". */
export const NOTES_SHOWN = 3;
const BLUR_KEY = "tyl:blur";

const REASON_TEXT: Record<ReportReason, string> = {
  sexual: strings.report.reasonSexual,
  hate: strings.report.reasonHate,
  violence: strings.report.reasonViolence,
  spam: strings.report.reasonSpam,
  other: strings.report.reasonOther,
};

const BAN_TEXT: Record<BanLength, string> = {
  week: strings.mod.banWeek,
  month: strings.mod.banMonth,
  three_months: strings.mod.banThreeMonths,
  six_months: strings.mod.banSixMonths,
  forever: strings.mod.banForever,
};

const BANNED_FOR: Record<BanLength, string> = {
  week: strings.mod.bannedWeek,
  month: strings.mod.bannedMonth,
  three_months: strings.mod.bannedThreeMonths,
  six_months: strings.mod.bannedSixMonths,
  forever: strings.mod.bannedForever,
};

type Deciding =
  | { status: "idle" }
  | { status: "choosingBan"; ban: BanLength | null }
  | { status: "confirmForever" }
  | { status: "acting" }
  | { status: "failed" };

function QueueCard({
  item,
  blur,
  now,
  takeDown,
  leaveUp,
  onDone,
}: {
  item: QueuedList;
  blur: boolean;
  now: number;
  takeDown: TakeDown;
  leaveUp: LeaveUp;
  onDone: (notice: string) => void;
}) {
  const [deciding, setDeciding] = useState<Deciding>({ status: "idle" });
  const [revealed, setRevealed] = useState(false);
  const [allNotes, setAllNotes] = useState(false);
  const acting = deciding.status === "acting";
  const counts = reasonCounts(item.reasons);
  const notes = allNotes ? item.notes : item.notes.slice(0, NOTES_SHOWN);

  const settle = (work: Promise<void>, notice: string) => {
    setDeciding({ status: "acting" });
    work.then(
      () => onDone(notice),
      () => setDeciding({ status: "failed" }),
    );
  };

  const keep = () => settle(leaveUp(item.listId), strings.mod.leftUp);

  const remove = (ban: BanLength | null) =>
    settle(
      takeDown(item.listId, ban),
      ban === null
        ? strings.mod.takenDown
        : fill(strings.mod.takenDownBanned, { name: item.authorName, length: BANNED_FOR[ban] }),
    );

  const choose = (ban: BanLength | null) => setDeciding({ status: "choosingBan", ban });

  const commit = () => {
    if (deciding.status !== "choosingBan") return;
    if (deciding.ban === "forever") setDeciding({ status: "confirmForever" });
    else remove(deciding.ban);
  };

  return (
    <li className={acting ? "queue__card queue__card--acting" : "queue__card"}>
      {deciding.status === "failed" && (
        <p className="queue__bar" role="alert">
          <Icon name="cloud_off" className="queue__bar-icon" />
          {strings.mod.failedDecision}
          <button
            type="button"
            className="queue__retry"
            onClick={() => setDeciding({ status: "idle" })}
          >
            {strings.mod.tryAgain}
          </button>
        </p>
      )}
      <div className="queue__body">
        <button
          type="button"
          className={blur && !revealed ? "queue__cover queue__cover--blurred" : "queue__cover"}
          aria-label={blur && !revealed ? strings.mod.revealCover : strings.mod.cover}
          onClick={() => setRevealed(true)}
          disabled={!blur || revealed}
        >
          {item.coverImageUrl !== null ? (
            <img src={item.coverImageUrl} alt="" loading="lazy" />
          ) : (
            <span className="queue__cover-none">{strings.mod.noCover}</span>
          )}
          {blur && !revealed && <Icon name="visibility_off" className="queue__cover-icon" />}
        </button>
        <div className="queue__text">
          <h2 className="queue__title">{item.listTitle}</h2>
          <p className="queue__byline">{fill(strings.card.by, { name: item.authorName })}</p>
          <div className="queue__pills">
            <span className="queue__pill queue__pill--count">
              {plural(strings.mod.reportCount, item.reportCount)}
            </span>
            {item.hidden && <span className="queue__pill">{strings.mod.hiddenPill}</span>}
            {item.reviewed && !item.hidden && (
              <span className="queue__pill">{strings.mod.alreadyKept}</span>
            )}
          </div>
          <div className="queue__reasons">
            {counts.map(({ reason, count }) => (
              <p key={reason} className="queue__reason">
                <strong>{count}</strong> · {REASON_TEXT[reason]}
              </p>
            ))}
            {notes.map((note, index) => (
              <p key={index} className="queue__note">
                <Icon name="format_quote" className="queue__note-icon" />
                {note}
              </p>
            ))}
            {!allNotes && item.notes.length > NOTES_SHOWN && (
              <button type="button" className="queue__more" onClick={() => setAllNotes(true)}>
                {plural(strings.mod.moreNotes, item.notes.length - NOTES_SHOWN)}
              </button>
            )}
            <p className="queue__when">{agoText(item.newestAtMs, now)}</p>
          </div>
          <p className="queue__consequence">{strings.mod.consequence}</p>

          {deciding.status === "choosingBan" || deciding.status === "confirmForever" ? (
            <div className="queue__panel" role="group" aria-label={strings.mod.banQuestion}>
              <p className="queue__panel-line">{strings.mod.banQuestion}</p>
              <div className="queue__chips">
                {[null, ...BAN_LENGTHS].map((ban) => (
                  <button
                    key={ban ?? "none"}
                    type="button"
                    className="queue__chip"
                    aria-pressed={deciding.status === "choosingBan" && deciding.ban === ban}
                    onClick={() => choose(ban)}
                  >
                    {ban === null ? strings.mod.banNone : BAN_TEXT[ban]}
                  </button>
                ))}
              </div>
              <div className="queue__panel-actions">
                <Button onClick={() => setDeciding({ status: "idle" })}>
                  {strings.mod.cancel}
                </Button>
                <button type="button" className="btn dialog__danger" onClick={commit}>
                  <span>{strings.mod.takeDown}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="queue__actions">
              <Button variant="tonal" icon="check" onClick={keep} disabled={acting}>
                {strings.mod.leaveUp}
              </Button>
              <button
                type="button"
                className="btn dialog__danger"
                onClick={() => choose(null)}
                disabled={acting}
              >
                <Icon name="visibility_off" className="btn__icon" />
                <span>{acting ? strings.mod.acting : strings.mod.takeDown}</span>
              </button>
              <a
                className="btn btn--text queue__open"
                href={`/l/${encodeURIComponent(item.listId)}`}
                target="_blank"
                rel="noopener"
              >
                <span>{strings.mod.openList}</span>
              </a>
            </div>
          )}
        </div>
      </div>
      {deciding.status === "confirmForever" && (
        <ForeverDialog
          name={item.authorName}
          onCancel={() => setDeciding({ status: "choosingBan", ban: "forever" })}
          onConfirm={() => remove("forever")}
        />
      )}
    </li>
  );
}

function ForeverDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="scrim" onClick={onCancel}>
      <div
        className="dialog dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forever-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="forever-title" className="dialog__title">
          {fill(strings.mod.foreverTitle, { name })}
        </h2>
        <p className="dialog__body">{strings.mod.foreverBody}</p>
        <div className="dialog__actions">
          <button ref={cancel} type="button" className="btn btn--text" onClick={onCancel}>
            <span>{strings.mod.cancel}</span>
          </button>
          <button type="button" className="btn dialog__danger" onClick={onConfirm}>
            <span>{strings.mod.banForeverAction}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function readBlur(): boolean {
  try {
    return localStorageStore.read(BLUR_KEY) === "1";
  } catch {
    return false;
  }
}

function Queue({
  uid,
  load,
  takeDown,
  leaveUp,
}: {
  uid: string;
  load: LoadQueue;
  takeDown: TakeDown;
  leaveUp: LeaveUp;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);
  const [gone, setGone] = useState<readonly string[]>([]);
  const [blur, setBlur] = useState(readBlur);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const toggleBlur = () => {
    const next = !blur;
    setBlur(next);
    try {
      if (next) localStorageStore.write(BLUR_KEY, "1");
      else localStorageStore.remove(BLUR_KEY);
    } catch {
      // Blur for the visit only.
    }
  };

  if (state.status === "loading") {
    return (
      <div className="queue queue--loading" aria-busy="true" aria-label={strings.mod.title}>
        <Skeleton height="200px" className="queue__placeholder" />
        <Skeleton height="200px" className="queue__placeholder" />
        <Skeleton height="200px" className="queue__placeholder" />
      </div>
    );
  }
  if (state.status === "error") {
    if (state.error.kind === "notYours" || state.error.kind === "notSignedIn") {
      return <NotAvailable />;
    }
    return (
      <div className="queue__trouble" role="alert">
        <p>{strings.mod.failed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.mod.tryAgain}
        </Button>
      </div>
    );
  }

  const items = state.value.reports.filter((item) => !gone.includes(item.listId));
  const reports = items.reduce((sum, item) => sum + item.reportCount, 0);

  const onDone = (id: string, text: string) => {
    const left = items.filter((item) => item.listId !== id);
    setGone((ids) => [...ids, id]);
    noteReports(uid, left);
    setNotice({ text });
  };

  return (
    <>
      <div className="mod__head">
        <p className="mod__count">
          {items.length === 0
            ? strings.mod.nothingPending
            : `${plural(strings.mod.listCount, items.length)} · ${plural(strings.mod.reportCount, reports)}`}
        </p>
        <label className="mod__blur">
          <span>{strings.mod.blurCovers}</span>
          <input type="checkbox" role="switch" checked={blur} onChange={toggleBlur} />
        </label>
      </div>
      {items.length === 0 ? (
        <div className="mod__empty">
          <Icon name="shield" className="mod__empty-icon" />
          <p className="mod__empty-title">{strings.mod.emptyTitle}</p>
          <p className="mod__empty-body">{strings.mod.emptyBody}</p>
        </div>
      ) : (
        <ul className="queue" aria-label={strings.mod.title}>
          {items.map((item) => (
            <QueueCard
              key={item.listId}
              item={item}
              blur={blur}
              now={now}
              takeDown={takeDown}
              leaveUp={leaveUp}
              onDone={(text) => onDone(item.listId, text)}
            />
          ))}
        </ul>
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </>
  );
}

function NotAvailable() {
  return (
    <div className="mod__empty">
      <p className="mod__empty-title">{strings.mod.notAvailable}</p>
    </div>
  );
}

export function ModerationPage({
  load = loadReports,
  takeDown = takeDownList,
  leaveUp = leaveListUp,
}: ModerationPageProps) {
  const { account } = useSession();
  return (
    <section className="mod">
      <h1 className="mod__title">{strings.mod.title}</h1>
      {account === null && <Skeleton height="20px" width="40%" />}
      {account?.kind === "guest" && <NotAvailable />}
      {account?.kind === "signedIn" && (
        <Queue uid={account.uid} load={load} takeDown={takeDown} leaveUp={leaveUp} />
      )}
    </section>
  );
}
