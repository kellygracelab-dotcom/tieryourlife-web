import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalList } from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { BanLength } from "../../api/moderation";
import { BAN_LENGTHS } from "../../api/moderation";
import { useSession } from "../../app/session";
import { approveList, loadApprovals, takeDownList } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { BAN_TEXT, BANNED_FOR, ForeverDialog } from "../moderation/bans";
import { agoText } from "../moderation/queue";
import { noteAdminDecision } from "./useAdminCounts";
import "../../pages/ModerationPage.css";

export type LoadApprovals = () => Promise<{ lists: ApprovalList[] }>;
export type Approve = (id: string) => Promise<void>;
export type Remove = (id: string, ban: BanLength | null) => Promise<void>;

type Decision = { kind: "approve" } | { kind: "remove"; ban: BanLength | null };

type Deciding =
  | { status: "idle" }
  | { status: "choosingBan"; ban: BanLength | null }
  | { status: "confirmForever" }
  | { status: "acting" }
  // What was decided is kept, so Try again sends it again, ban and all.
  | { status: "failed"; decision: Decision; staff: boolean };

/** Whose: the name the list carries, or the one staff are told when it carries none. */
function authorOf(item: ApprovalList): string {
  if (item.anonymous !== true) return item.authorName || strings.admin.anonymousAuthor;
  return item.publishedBy !== null
    ? fill(strings.admin.anonymousOf, { name: item.publishedBy.name })
    : strings.admin.anonymousAuthor;
}

function ApprovalCard({
  item,
  now,
  approve,
  remove,
  onDone,
}: {
  item: ApprovalList;
  now: number;
  approve: Approve;
  remove: Remove;
  onDone: (notice: string) => void;
}) {
  const [deciding, setDeciding] = useState<Deciding>({ status: "idle" });
  const acting = deciding.status === "acting";
  const choosing = deciding.status === "choosingBan" || deciding.status === "confirmForever";
  const author = authorOf(item);
  const title = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  // The ban question takes the place of Remove: the focus goes into it and back.
  const wasChoosing = useRef(false);
  useEffect(() => {
    if (choosing && !wasChoosing.current) {
      panel.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
    } else if (!choosing && wasChoosing.current) {
      (deciding.status === "idle" ? removeButton.current : title.current)?.focus();
    }
    wasChoosing.current = choosing;
  }, [choosing, deciding.status]);

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

  const doApprove = () => settle(approve(item.id), strings.admin.approvedList, { kind: "approve" });

  const doRemove = (ban: BanLength | null) =>
    settle(
      remove(item.id, ban),
      ban === null
        ? strings.mod.takenDown
        : fill(strings.mod.takenDownBanned, { name: author, length: BANNED_FOR[ban] }),
      { kind: "remove", ban },
    );

  const again = (decision: Decision) => {
    title.current?.focus();
    if (decision.kind === "approve") doApprove();
    else doRemove(decision.ban);
  };

  const commit = () => {
    if (deciding.status !== "choosingBan") return;
    if (deciding.ban === "forever") setDeciding({ status: "confirmForever" });
    else doRemove(deciding.ban);
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
        <span className="queue__cover" aria-hidden="true">
          {item.coverImageUrl !== null ? (
            <MediaImage src={item.coverImageUrl} alt="" loading="lazy" />
          ) : item.previewImages[0] !== undefined ? (
            <MediaImage src={item.previewImages[0]} alt="" loading="lazy" />
          ) : (
            <span className="queue__cover-none">{item.title}</span>
          )}
        </span>
        <div className="queue__text">
          <h3 ref={title} className="queue__title" tabIndex={-1}>
            {item.title}
          </h3>
          <p className="queue__byline">{fill(strings.card.by, { name: author })}</p>
          <div className="queue__pills">
            <span className="queue__pill queue__pill--count">
              {plural(strings.boards.cards, item.itemCount)}
            </span>
            {item.underReview && <span className="queue__pill">{strings.admin.underReview}</span>}
          </div>
          <p className="queue__when">
            {fill(strings.admin.publishedWhen, { when: agoText(item.publishedAt, now) })}
          </p>

          {choosing ? (
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
                    onClick={() => setDeciding({ status: "choosingBan", ban })}
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
                  <span>{strings.admin.removeList}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="queue__actions">
              <Button variant="tonal" icon="check" onClick={doApprove} disabled={acting}>
                {strings.admin.approve}
              </Button>
              <button
                ref={removeButton}
                type="button"
                className="btn dialog__danger"
                onClick={() => setDeciding({ status: "choosingBan", ban: null })}
                disabled={acting}
              >
                <Icon name="visibility_off" className="btn__icon" />
                <span>{acting ? strings.mod.acting : strings.admin.removeList}</span>
              </button>
              <a
                className="btn btn--text queue__open"
                href={`/l/${encodeURIComponent(item.id)}`}
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
          onConfirm={() => doRemove("forever")}
        />
      )}
    </li>
  );
}

function Queue({
  uid,
  load,
  approve,
  remove,
}: {
  uid: string;
  load: LoadApprovals;
  approve: Approve;
  remove: Remove;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);
  const [gone, setGone] = useState<readonly string[]>([]);
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

  if (state.status === "loading") {
    return (
      <div className="queue queue--loading" aria-busy="true" aria-label={strings.admin.approvals} />
    );
  }
  if (state.status === "error") {
    return (
      <div className="queue__trouble" role="alert">
        <p>{strings.admin.approvalsFailed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.mod.tryAgain}
        </Button>
      </div>
    );
  }

  // The longest waiting first, as the backend sends them.
  const items = state.value.lists.filter((item) => !gone.includes(item.id));
  const onDone = (id: string, text: string) => {
    left.current = items.findIndex((item) => item.id === id);
    setGone((ids) => [...ids, id]);
    noteAdminDecision();
    setNotice({ text });
  };

  return (
    <>
      <div className="mod__head">
        <p ref={count} className="mod__count" tabIndex={-1}>
          {items.length === 0
            ? strings.admin.approvalsEmptyTitle
            : plural(strings.admin.approvalsCount, items.length)}
        </p>
      </div>
      {items.length === 0 ? (
        <div className="mod__empty">
          <Icon name="schedule" className="mod__empty-icon" />
          <p className="mod__empty-title">{strings.admin.approvalsEmptyTitle}</p>
          <p className="mod__empty-body">{strings.admin.approvalsEmptyBody}</p>
        </div>
      ) : (
        <ul ref={queue} className="queue" aria-label={strings.admin.approvals}>
          {items.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              now={now}
              approve={approve}
              remove={remove}
              onDone={(text) => onDone(item.id, text)}
            />
          ))}
        </ul>
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </>
  );
}

/**
 * New lists waiting for staff before the feed, the longest waiting first
 * (Danylo's decision of 26.11.2026; CONTRACT, Approval before the feed).
 * Approve lets one into the feed; Remove takes it down, with a ban if chosen,
 * as a report does. Their links already work for everybody.
 */
export function ApprovalsPane({
  load = loadApprovals,
  approve = approveList,
  remove = takeDownList,
}: {
  load?: LoadApprovals;
  approve?: Approve;
  remove?: Remove;
}) {
  const { account } = useSession();
  return (
    <section className="mod">
      <h2 className="mod__title">{strings.admin.approvals}</h2>
      {account?.kind === "signedIn" && (
        <Queue uid={account.uid} load={load} approve={approve} remove={remove} />
      )}
    </section>
  );
}
