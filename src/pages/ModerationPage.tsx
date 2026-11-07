import { useCallback, useEffect, useRef, useState } from "react";
import { errorOf } from "../api/errors";
import { BAN_LENGTHS, type BanLength, type QueuedList } from "../api/moderation";
import { useSession } from "../app/session";
import { REASON_TEXT } from "../features/community/reasons";
import { noteAdminDecision } from "../features/admin/useAdminCounts";
import { noteReports } from "../features/moderation/useModerator";
import { useResource } from "../lib/useResource";
import { leaveListUp, loadReports, takeDownList } from "../lib/api";
import { agoText, reasonCounts } from "../features/moderation/queue";
import { localStorageStore } from "../lib/storage";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./ModerationPage.css";
import { usePageTitle } from "../app/pageTitle";

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
  // What was decided is kept, so Try again sends it again, ban and all.
  // A list by staff is the owner's alone to judge: no Try again for that one.
  | { status: "failed"; decision: Decision; staff: boolean };

type Decision = { kind: "keep" } | { kind: "remove"; ban: BanLength | null };

// Who wrote an anonymous list is not the moderator's to know
// (docs/design-spec-walk-3.md, E2). The proxy leaves the name out for them;
// the owner's queue still has it and says whose, as the list of lists does.
function authorOf(item: QueuedList): string {
  if (item.anonymous !== true) return item.authorName || strings.admin.anonymousAuthor;
  return item.authorName
    ? fill(strings.admin.anonymousOf, { name: item.authorName })
    : strings.admin.anonymousAuthor;
}

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
  const choosing = deciding.status === "choosingBan" || deciding.status === "confirmForever";
  const counts = reasonCounts(item.reasons);
  const author = authorOf(item);
  const title = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const takeDownButton = useRef<HTMLButtonElement>(null);
  // The panel takes the place of the button that opened it, so the focus goes
  // with it: into the ban in force on the way in, back to Take it down on the
  // way out, and to the card's title while the decision is under way.
  const wasChoosing = useRef(false);
  useEffect(() => {
    if (choosing && !wasChoosing.current) {
      panel.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
    } else if (!choosing && wasChoosing.current) {
      (deciding.status === "idle" ? takeDownButton.current : title.current)?.focus();
    }
    wasChoosing.current = choosing;
  }, [choosing, deciding.status]);
  const notes = allNotes ? item.notes : item.notes.slice(0, NOTES_SHOWN);

  const settle = (work: Promise<void>, notice: string, decision: Decision) => {
    setDeciding({ status: "acting" });
    work.then(
      () => onDone(notice),
      (reason: unknown) =>
        setDeciding({
          status: "failed",
          decision,
          staff: errorOf(reason).kind === "targetIsModerator",
        }),
    );
  };

  // Dismissing clears the complaints; a list hidden while it waited comes back.
  const keep = () =>
    settle(leaveUp(item.listId), item.hidden ? strings.mod.putBackDone : strings.mod.leftUp, {
      kind: "keep",
    });

  const remove = (ban: BanLength | null) =>
    settle(
      takeDown(item.listId, ban),
      ban === null
        ? strings.mod.takenDown
        : fill(strings.mod.takenDownBanned, { name: author, length: BANNED_FOR[ban] }),
      { kind: "remove", ban },
    );

  const again = (decision: Decision) => {
    // The bar and its button go while it is sent again: the focus waits on the title.
    title.current?.focus();
    if (decision.kind === "keep") keep();
    else remove(decision.ban);
  };

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
          {deciding.staff ? strings.mod.staffList : strings.mod.failedDecision}
          {!deciding.staff && (
            <button type="button" className="queue__retry" onClick={() => again(deciding.decision)}>
              {strings.mod.tryAgain}
            </button>
          )}
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
            <span className="queue__cover-none">{item.listTitle}</span>
          )}
          {blur && !revealed && <Icon name="visibility_off" className="queue__cover-icon" />}
        </button>
        <div className="queue__text">
          <h3 ref={title} className="queue__title" tabIndex={-1}>
            {item.listTitle}
          </h3>
          <p className="queue__byline">{fill(strings.card.by, { name: author })}</p>
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
            <div
              ref={panel}
              className="queue__panel"
              role="group"
              aria-label={strings.mod.banQuestion}
              onKeyDown={(event) => {
                if (event.key === "Escape" && deciding.status === "choosingBan") {
                  event.preventDefault();
                  setDeciding({ status: "idle" });
                }
              }}
            >
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
                {item.hidden ? strings.mod.putBack : strings.mod.leaveUp}
              </Button>
              <button
                ref={takeDownButton}
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
          name={author}
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
  return (
    <ConfirmDialog
      narrow
      title={fill(strings.mod.foreverTitle, { name })}
      body={strings.mod.foreverBody}
      confirmLabel={strings.mod.banForeverAction}
      cancelLabel={strings.mod.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
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
  const queue = useRef<HTMLUListElement>(null);
  const count = useRef<HTMLParagraphElement>(null);
  // Where a decided card stood: the focus it held goes to the card now in its place.
  const left = useRef<number | null>(null);
  useEffect(() => {
    const at = left.current;
    left.current = null;
    if (at === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const titles = queue.current?.querySelectorAll<HTMLElement>(".queue__title") ?? [];
    (titles[Math.min(at, titles.length - 1)] ?? count.current)?.focus();
  }, [gone]);

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
      // Nothing in its place, as the other panes do: grey blocks the size of a
      // guess flashed and then jumped to the reports.
      <div className="queue queue--loading" aria-busy="true" aria-label={strings.mod.title} />
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
    const rest = items.filter((item) => item.listId !== id);
    left.current = items.findIndex((item) => item.listId === id);
    setGone((ids) => [...ids, id]);
    noteReports(uid, rest);
    noteAdminDecision();
    setNotice({ text });
  };

  return (
    <>
      <div className="mod__head">
        <p ref={count} className="mod__count" tabIndex={-1}>
          {items.length === 0
            ? strings.mod.nothingPending
            : `${plural(strings.mod.listCount, items.length)} · ${plural(strings.mod.reportCount, reports)}`}
        </p>
        <label className="mod__blur">
          <span>{strings.mod.blurCovers}</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={blur}
            onChange={toggleBlur}
          />
        </label>
      </div>
      {items.length === 0 ? (
        <div className="mod__empty">
          <Icon name="shield" className="mod__empty-icon" />
          <p className="mod__empty-title">{strings.mod.emptyTitle}</p>
          <p className="mod__empty-body">{strings.mod.emptyBody}</p>
        </div>
      ) : (
        <ul ref={queue} className="queue" aria-label={strings.mod.title}>
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
  usePageTitle(strings.mod.title, { inBar: false });
  const { account } = useSession();
  return (
    <section className="mod">
      {/* A pane of Admin, whose h1 names the page: the pane's title is the next level down. */}
      <h2 className="mod__title">{strings.mod.title}</h2>
      {account?.kind === "guest" && <NotAvailable />}
      {account?.kind === "signedIn" && (
        <Queue uid={account.uid} load={load} takeDown={takeDown} leaveUp={leaveUp} />
      )}
    </section>
  );
}
