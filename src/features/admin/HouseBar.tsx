import { useEffect, useRef, useState } from "react";
import type { HouseAnswer } from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { PublishRequest } from "../../api/lists";
import type { PublishedList } from "../../api/types";
import { loadListAsWritten, publishAsHouse, replaceHouseList } from "../../lib/api";
import { busyUntil } from "../../lib/busyWait";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { houseRequestOf, type HouseBase } from "../boards/houseList";
import type { Board } from "../boards/model";
import { publishProblemsOf } from "../boards/publish";
import {
  busyText,
  creditRefusalText,
  failureText,
  isHouseBusy,
  problemText,
  type HouseSend,
} from "./houseWords";
import "./house.css";

/** The house's two ways out: a new list, or a new snapshot of one. */
/** What a send answers, and the list's own updatedAt when it could be read back after. */
export type HouseSent = HouseAnswer & { updatedAt?: number; list?: PublishedList };

export interface HouseSending {
  publish: (request: PublishRequest) => Promise<HouseSent>;
  replace: (id: string, request: PublishRequest) => Promise<HouseSent>;
  /** The list as it stands, as written, for a board that fell behind it. */
  load: (id: string) => Promise<PublishedList>;
}

/**
 * The backend's answer does not say when, by its clock, the list now stands
 * as sent: it is read back, so this device can tell another admin's later
 * change from its own without asking its own clock. Not read, it is unknown.
 */
const readBack = (answer: HouseAnswer): Promise<HouseSent> =>
  loadListAsWritten(answer.id).then(
    (list) => ({ ...answer, updatedAt: list.updatedAt, list }),
    () => answer,
  );

const houseSending: HouseSending = {
  publish: (request) => publishAsHouse(request).then(readBack),
  replace: (id, request) => replaceHouseList(id, request).then(readBack),
  load: loadListAsWritten,
};

/** The admin pane the house's lists are kept in, where a board edited for the house leads back to. */
export const HOUSE_PANE_PATH = "/admin/house";

export interface HouseBarProps {
  /** The board as drawn, for what stands in its way. */
  board: Board;
  /** The board as it is right now, for what goes out. */
  latest: () => Board;
  /** The house list this board updates; null until its first publish. */
  listId: string | null;
  /** The list revision the board stands on, read when it goes out: its `baseRevision`. */
  base: () => HouseBase;
  send?: HouseSending;
  /**
   * It went out: the page ties the board to the list and says so, and keeps
   * the revision the list now has, null when the answer said none.
   */
  onSent: (
    what: "published" | "updated",
    id: string,
    updatedAt: number | null,
    revision: number | null,
    /** The list as read back after it went out, when it was. */
    list?: PublishedList | null,
  ) => void;
  /** The list it updated was taken down elsewhere: the board is a new house list again. */
  onGone: () => void;
  /** The list as it stands now, read for the board to become: the page puts it in the board's place. */
  onLoaded: (list: PublishedList) => void;
}

/** What stands in the bar after a send that did not go out. */
type Trouble =
  /**
   * `retry`: the same may go again, by the editor's hand. `waiting`: it goes
   * again by itself at the time the backend gave, until the board is edited.
   */
  | { kind: "failed"; text: string; retry: boolean; waiting?: boolean }
  /** The list moved on since the board was read: Update would put the older one back. */
  | { kind: "changed"; loading: boolean; failed: boolean };

/**
 * A board edited for the house says so above its tiers, and goes out from
 * here and nowhere else: the same request the board's own publish makes,
 * sent to the house's address, so no name, no face and no account go with
 * it. The board's own Public switch is not offered while it is the house's.
 */
export function HouseBar({
  board,
  latest,
  listId,
  base,
  send = houseSending,
  onSent,
  onGone,
  onLoaded,
}: HouseBarProps) {
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const problems = publishProblemsOf(board);
  const kind: HouseSend = listId === null ? "publish" : "replace";

  // A send held back by its pictures goes again by itself at the time the
  // backend gave, exactly as it went (the same revision too), as a paste
  // waits for a busy site: so many times, never longer than a paste waits.
  // Leaving the board or editing it stops that; Try again is then the editor's.
  const again = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The board's edit time the waiting send was made of. */
  const heldAt = useRef<number | null>(null);
  const alive = useRef(true);
  const stopWaiting = () => {
    if (again.current !== null) clearTimeout(again.current);
    again.current = null;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (again.current !== null) clearTimeout(again.current);
      again.current = null;
    };
  }, []);
  const editedAt = board.editedAt;
  useEffect(() => {
    if (again.current === null || heldAt.current === editedAt) return;
    clearTimeout(again.current);
    again.current = null;
    setTrouble((was) =>
      was?.kind === "failed" && was.waiting === true
        ? { ...was, waiting: false, retry: true }
        : was,
    );
  }, [editedAt]);

  const sendOut = (request: PublishRequest, tries: number) => {
    stopWaiting();
    setBusy(true);
    setTrouble(null);
    const sent = listId === null ? send.publish(request) : send.replace(listId, request);
    sent.then(
      (answer) => {
        setBusy(false);
        onSent(
          listId === null ? "published" : "updated",
          answer.id,
          answer.updatedAt ?? null,
          answer.revision ?? null,
          answer.list ?? null,
        );
      },
      (reason: unknown) => {
        setBusy(false);
        const error = errorOf(reason);
        if (kind === "replace" && error.kind === "notFound") onGone();
        if (kind === "replace" && error.kind === "sourceChanged") {
          setTrouble({ kind: "changed", loading: false, failed: false });
          return;
        }
        if (isHouseBusy(error)) {
          const now = Date.now();
          const until = alive.current ? busyUntil(error.retryAt, tries, now) : null;
          const text = busyText(error, request, until ?? error.retryAt ?? now);
          if (until === null) {
            setTrouble({ kind: "failed", text, retry: true });
            return;
          }
          setTrouble({ kind: "failed", text, retry: false, waiting: true });
          heldAt.current = latest().editedAt;
          again.current = setTimeout(
            () => {
              again.current = null;
              sendOut(request, tries + 1);
            },
            Math.max(0, until - now),
          );
          return;
        }
        // A picture from a link with no page: the card it names, by its place in what was sent.
        const card =
          error.kind === "pictureRefused" &&
          error.code === "PICTURE_LINK_NEEDED" &&
          error.itemIndex !== undefined
            ? request.items[error.itemIndex]
            : undefined;
        setTrouble({
          kind: "failed",
          text:
            card === undefined
              ? (creditRefusalText(error, request) ?? failureText(error, kind))
              : fill(strings.link.linkNeeded, { name: card.title }),
          // Another write crossed this one: nothing was written, and the same send may go again.
          retry: error.kind === "publicationChanged",
        });
      },
    );
  };

  // Over a list already out, the board goes with the revision it was read at:
  // the backend then refuses it once the list moved on, and nothing is written.
  // Never sent again on its own: the editor loads the list as it stands.
  const go = () => {
    const own = houseRequestOf(latest(), listId);
    if (own === null) return;
    const at = listId === null ? null : base();
    if (at === "behind") {
      stopWaiting();
      setTrouble({ kind: "changed", loading: false, failed: false });
      return;
    }
    sendOut(at === null ? own : { ...own, baseRevision: at }, 1);
  };

  // The board becomes the list as it stands: the edits made here since it was
  // read give way, as the editor asked.
  const loadCurrent = () => {
    if (listId === null) return;
    setTrouble({ kind: "changed", loading: true, failed: false });
    send.load(listId).then(
      (list) => {
        setTrouble(null);
        onLoaded(list);
      },
      (reason: unknown) => {
        if (errorOf(reason).kind === "notFound") {
          setTrouble(null);
          onGone();
          return;
        }
        setTrouble({ kind: "changed", loading: false, failed: true });
      },
    );
  };

  return (
    <section className="house-bar" aria-label={strings.admin.houseBoard}>
      <Icon name="public" className="house-bar__icon" />
      <div className="house-bar__text">
        <p className="house-bar__title">{strings.admin.houseBoard}</p>
        <p className="house-bar__note">
          {listId === null ? strings.admin.houseBoardNew : strings.admin.houseBoardLinked}
        </p>
        {problems.length > 0 && (
          <p className="house-bar__problem">{problems.map(problemText).join(" ")}</p>
        )}
        {busy && (
          <p className="house-bar__note" role="status">
            {listId === null ? strings.new.publishing : strings.boards.updating}
          </p>
        )}
        {trouble?.kind === "failed" && (
          <p className="house-bar__problem" role="alert">
            {trouble.waiting === true
              ? `${trouble.text} ${strings.admin.houseRetrying}`
              : trouble.text}
          </p>
        )}
        {trouble?.kind === "changed" && (
          <p className="house-bar__problem" role="alert">
            {trouble.failed
              ? `${strings.admin.houseChanged} ${strings.admin.houseOpenFailed}`
              : strings.admin.houseChanged}
          </p>
        )}
      </div>
      <span className="house-bar__actions">
        {trouble?.kind === "changed" && (
          <Button variant="tonal" disabled={trouble.loading} onClick={loadCurrent}>
            {strings.admin.houseLoadCurrent}
          </Button>
        )}
        {trouble?.kind === "failed" && trouble.retry && (
          <Button variant="tonal" icon="refresh" disabled={busy} onClick={go}>
            {strings.feed.tryAgain}
          </Button>
        )}
        {listId !== null && (
          <Button href={`/l/${encodeURIComponent(listId)}`} external>
            {strings.admin.open}
          </Button>
        )}
        <Button
          variant="filled"
          icon="publish"
          disabled={busy || problems.length > 0 || trouble?.kind === "changed"}
          onClick={go}
        >
          {listId === null ? strings.admin.publishToHouse : strings.admin.updateHouse}
        </Button>
      </span>
    </section>
  );
}
