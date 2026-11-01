import { useState } from "react";
import type { HouseAnswer } from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { PublishRequest } from "../../api/lists";
import { publishAsHouse, replaceHouseList } from "../../lib/api";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { houseRequestOf } from "../boards/houseList";
import type { Board } from "../boards/model";
import { publishProblemsOf } from "../boards/publish";
import { failureText, problemText, type HouseSend } from "./houseWords";
import "./house.css";

/** The house's two ways out: a new list, or a new snapshot of one. */
export interface HouseSending {
  publish: (request: PublishRequest) => Promise<HouseAnswer>;
  replace: (id: string, request: PublishRequest) => Promise<HouseAnswer>;
}

const houseSending: HouseSending = { publish: publishAsHouse, replace: replaceHouseList };

/** The admin pane the house's lists are kept in, where a board edited for the house leads back to. */
export const HOUSE_PANE_PATH = "/admin/house";

interface HouseBarProps {
  /** The board as drawn, for what stands in its way. */
  board: Board;
  /** The board as it is right now, for what goes out. */
  latest: () => Board;
  /** The house list this board updates; null until its first publish. */
  listId: string | null;
  send?: HouseSending;
  /** It went out: the page ties the board to the list and says so. */
  onSent: (what: "published" | "updated", id: string) => void;
  /** The list it updated was taken down elsewhere: the board is a new house list again. */
  onGone: () => void;
}

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
  send = houseSending,
  onSent,
  onGone,
}: HouseBarProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const problems = publishProblemsOf(board);
  const kind: HouseSend = listId === null ? "publish" : "replace";

  const go = () => {
    const request = houseRequestOf(latest(), listId);
    if (request === null) return;
    setBusy(true);
    setFailure(null);
    const sent = listId === null ? send.publish(request) : send.replace(listId, request);
    sent.then(
      (answer) => {
        setBusy(false);
        onSent(listId === null ? "published" : "updated", answer.id);
      },
      (reason: unknown) => {
        setBusy(false);
        const error = errorOf(reason);
        if (kind === "replace" && error.kind === "notFound") onGone();
        setFailure(failureText(error, kind));
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
        {failure !== null && (
          <p className="house-bar__problem" role="alert">
            {failure}
          </p>
        )}
      </div>
      <span className="house-bar__actions">
        {listId !== null && (
          <Button href={`/l/${encodeURIComponent(listId)}`} external>
            {strings.admin.open}
          </Button>
        )}
        <Button variant="filled" icon="publish" disabled={busy || problems.length > 0} onClick={go}>
          {listId === null ? strings.admin.publishToHouse : strings.admin.updateHouse}
        </Button>
      </span>
    </section>
  );
}
