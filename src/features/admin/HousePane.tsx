import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { HouseAnswer } from "../../api/admin";
import { errorOf, type ApiError } from "../../api/errors";
import type { PublishRequest } from "../../api/lists";
import { isCategory, type ListSummary } from "../../api/types";
import { loadHouseLists, publishAsHouse, replaceHouseList, takeDownHouseList } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { useWidthClass } from "../../lib/useWidthClass";
import { currentLocale, fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/Icon";
import { ListArt } from "../../ui/ListArt";
import { Menu } from "../../ui/Menu";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { useModal } from "../../ui/useModal";
import { liveItems, type Board } from "../boards/model";
import { publishProblemsOf, publishRequestOf, type PublishProblem } from "../boards/publish";
import { boards as site, type BoardsRepository } from "../boards/repository";
import { useBoards } from "../boards/useBoards";
import { sectionName, type Section } from "../sections/model";
import { useSections } from "../sections/useSections";
import { PaneLoading } from "./PaneLoading";

type Page = { lists: ListSummary[]; nextCursor: string | null };

export interface HouseDeps {
  load: (after: string | null) => Promise<Page>;
  publish: (request: PublishRequest) => Promise<HouseAnswer>;
  replace: (id: string, request: PublishRequest) => Promise<HouseAnswer>;
  takeDown: (id: string) => Promise<void>;
  /** The boards of whoever is here, owner or moderator, read the way Your lists reads them. */
  repository: BoardsRepository;
}

const houseDeps: HouseDeps = {
  load: loadHouseLists,
  publish: publishAsHouse,
  replace: replaceHouseList,
  takeDown: takeDownHouseList,
  repository: site,
};

/** What the picker was opened for: a new house list, or a new snapshot of one. */
type Picking = { kind: "publish" } | { kind: "replace"; list: ListSummary };

const hrefOf = (id: string) => `/l/${encodeURIComponent(id)}`;

const dayOf = (millis: number) =>
  new Intl.DateTimeFormat(currentLocale(), { day: "numeric", month: "short" }).format(millis);

/** Why a board cannot go out, in the words its own settings use. */
function problemText(problem: PublishProblem): string {
  switch (problem) {
    case "category":
      return strings.new.needCategory;
    case "noItems":
      return strings.boards.needsItems;
    case "tooManyTiers":
      return strings.new.tooManyTiers;
    case "tooManyItems":
      return strings.new.tooManyCards;
  }
}

/**
 * What a refused publish or replace says. The backend refuses these as it
 * refuses any publish; a 403 means the one asking is not staff, or, for a
 * replace, that the list is not the house's.
 */
function failureText(error: ApiError, kind: Picking["kind"]): string {
  switch (error.kind) {
    case "invalid":
      return fill(strings.new.failedInvalid, { detail: error.detail ?? "" }).trim();
    case "tooLarge":
      return fill(strings.new.failedTooLarge, { detail: error.detail ?? "" }).trim();
    case "pictureRefused":
      return strings.admin.housePictureRefused;
    case "notYours":
      return kind === "publish" ? strings.admin.houseStaffOnly : strings.admin.houseNotHouse;
    case "notFound":
      if (kind === "replace") return strings.new.listGone;
      break;
  }
  return kind === "publish" ? strings.admin.houseFailed : strings.admin.houseReplaceFailed;
}

/** Where a list is filed, as far as this page knows: its section, and its topic when it has one. */
function placeOf(list: ListSummary, sections: readonly Section[]): string[] {
  const known = isCategory(list.category) || sections.some((one) => one.id === list.category);
  return [
    ...(known ? [sectionName(list.category, sections)] : []),
    ...(list.topicName ? [list.topicName] : []),
  ];
}

function HouseRow({
  list,
  sections,
  narrow,
  onReplace,
  onTakeDown,
}: {
  list: ListSummary;
  sections: readonly Section[];
  narrow: boolean;
  onReplace: () => void;
  onTakeDown: () => void;
}) {
  const href = hrefOf(list.id);
  return (
    <li className="admin-list">
      <span className="house-list__art" aria-hidden="true">
        <ListArt
          cover={list.coverImageUrl}
          previews={list.previewImages}
          tierColors={list.tierColors}
        />
      </span>
      <span className="admin-list__text">
        <span className="admin-list__title">{list.title}</span>
        <span className="admin-list__meta">
          {[...placeOf(list, sections), dayOf(list.updatedAt)].join(" · ")}
        </span>
      </span>
      {narrow ? (
        <Menu
          label={fill(strings.admin.listActions, { title: list.title })}
          button={<Icon name="more_vert" />}
        >
          <li>
            <a className="menu__action" href={href} target="_blank" rel="noopener">
              {strings.admin.open}
            </a>
          </li>
          <li>
            <button type="button" className="menu__action" onClick={onReplace}>
              {strings.admin.replaceFromBoard}
            </button>
          </li>
          <li>
            <button type="button" className="menu__action" onClick={onTakeDown}>
              {strings.admin.takeDown}
            </button>
          </li>
        </Menu>
      ) : (
        <span className="admin-list__actions">
          <Button href={href} external>
            {strings.admin.open}
          </Button>
          <Button onClick={onReplace}>{strings.admin.replaceFromBoard}</Button>
          <Button onClick={onTakeDown}>{strings.admin.takeDown}</Button>
        </span>
      )}
    </li>
  );
}

/**
 * One's own boards to send out as the house, the latest edited first. A
 * board that could not be published says why and cannot be picked, in the
 * same words its settings use.
 */
function BoardPicker({
  picking,
  boards,
  narrow,
  busy,
  failure,
  onPick,
  onClose,
}: {
  picking: Picking;
  boards: readonly Board[];
  narrow: boolean;
  busy: boolean;
  failure: string | null;
  onPick: (board: Board) => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    if (!busy) onClose();
  };
  useModal(box, close);
  const replacing = picking.kind === "replace";

  return createPortal(
    // The sheet from the bottom on a narrow screen is Move's, the same shape for the same job.
    <div className={narrow ? "scrim move-dialog__scrim--sheet" : "scrim"} onClick={close}>
      <div
        ref={box}
        className={narrow ? "dialog house-dialog move-dialog--sheet" : "dialog house-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {replacing
            ? fill(strings.admin.houseReplacePick, { title: picking.list.title })
            : strings.admin.housePick}
        </h2>
        <p className="house-dialog__note">
          {replacing ? strings.admin.houseReplaceNote : strings.admin.housePickNote}
        </p>
        {boards.length === 0 ? (
          <p className="house-dialog__note">{strings.admin.noBoards}</p>
        ) : (
          <ul className="house-pick">
            {boards.map((board) => {
              const problems = publishProblemsOf(board);
              return (
                <li key={board.uid}>
                  <button
                    type="button"
                    className="house-pick__board"
                    disabled={busy || problems.length > 0}
                    onClick={() => onPick(board)}
                  >
                    <span className="house-pick__name">
                      {board.title || strings.boards.untitled}
                    </span>
                    <span className="house-pick__meta">
                      {plural(strings.boards.cards, liveItems(board).length)}
                    </span>
                    {problems.length > 0 && (
                      <span className="house-pick__problem">
                        {problems.map(problemText).join(" ")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {busy && (
          <p className="house-dialog__note" role="status">
            {replacing ? strings.admin.houseReplacing : strings.new.publishing}
          </p>
        )}
        {failure !== null && (
          <p className="admin__bar house-dialog__trouble" role="alert">
            {failure}
          </p>
        )}
        <div className="dialog__actions">
          <Button onClick={close} disabled={busy}>
            {strings.admin.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Lists the house publishes: no name, no face and no account behind them,
 * an ordinary anonymous list to everybody who opens one. The owner or a
 * moderator sends one of their own boards out as the house, or sends one
 * again over a house list, and the board itself stays a private board:
 * nothing about its own published state changes. A house list is changed
 * through a copy, as the note under the head says, since no board of
 * anybody's is tied to it.
 */
export function HousePane({ deps = houseDeps }: { deps?: HouseDeps }) {
  const navigate = useNavigate();
  const narrow = useWidthClass() !== "expanded";
  // Each publish or replace reads the lists again from the top, where it now stands.
  const [round, setRound] = useState(0);
  const first = useCallback(() => deps.load(null), [deps]);
  const { state, retry } = useResource(`house:${round}`, first);
  const [more, setMore] = useState<{ round: number; page: Page } | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState<Picking | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [asking, setAsking] = useState<ListSummary | null>(null);
  const [takingDown, setTakingDown] = useState(false);
  const [takeDownFailed, setTakeDownFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const { sections } = useSections();
  const own = [...useBoards(deps.repository)]
    .filter((board) => board.deletedAt === null)
    .sort((a, b) => b.editedAt - a.editedAt);

  const page = state.status === "ready" ? state.value : null;
  const extra = more !== null && more.round === round ? more.page : null;
  const lists = [...(page?.lists ?? []), ...(extra?.lists ?? [])].filter(
    (list) => !gone.has(list.id),
  );
  const next = extra !== null ? extra.nextCursor : (page?.nextCursor ?? null);

  const again = () => {
    setMore(null);
    setMoreFailed(false);
    setRound((n) => n + 1);
  };

  const showMore = (cursor: string) => {
    setMoreFailed(false);
    deps.load(cursor).then(
      (answer) =>
        setMore({
          round,
          page: {
            lists: [...(extra?.lists ?? []), ...answer.lists],
            nextCursor: answer.nextCursor,
          },
        }),
      (reason: unknown) => {
        // The list the page ended at went: the lists start again from the top.
        if (errorOf(reason).kind === "cursorGone") again();
        else setMoreFailed(true);
      },
    );
  };

  const open = (what: Picking) => {
    setFailure(null);
    setPicking(what);
  };

  // The request is the board's own publish, sent to the house's address; the
  // board is only read, never saved, so it stays private and unpublished.
  const pick = (board: Board) => {
    const request = publishRequestOf(board);
    if (picking === null || request === null) return;
    const what = picking;
    setSending(true);
    setFailure(null);
    const sent =
      what.kind === "publish" ? deps.publish(request) : deps.replace(what.list.id, request);
    sent.then(
      (answer) => {
        setSending(false);
        setPicking(null);
        again();
        setNotice({
          text:
            what.kind === "publish" ? strings.admin.housePublished : strings.admin.houseReplaced,
          action: {
            text: strings.admin.open,
            onClick: () => void navigate(hrefOf(answer.id)),
          },
        });
      },
      (reason: unknown) => {
        setSending(false);
        const error = errorOf(reason);
        // A list taken down elsewhere leaves this page too.
        if (what.kind === "replace" && error.kind === "notFound") {
          setGone((before) => new Set([...before, what.list.id]));
        }
        setFailure(failureText(error, what.kind));
      },
    );
  };

  const takeDown = (list: ListSummary) => {
    setTakingDown(true);
    setTakeDownFailed(false);
    deps.takeDown(list.id).then(
      () => {
        setTakingDown(false);
        setAsking(null);
        setGone((before) => new Set([...before, list.id]));
        setNotice({ text: fill(strings.admin.takenDown, { title: list.title }) });
      },
      () => {
        setTakingDown(false);
        setTakeDownFailed(true);
      },
    );
  };

  return (
    <section className="admin-pane" aria-labelledby="admin-house">
      <header className="admin-pane__head">
        <h2 id="admin-house" className="admin-pane__title">
          {strings.admin.house}
        </h2>
        <p className="admin-pane__count">{strings.admin.houseBody}</p>
        <Button variant="tonal" icon="publish" onClick={() => open({ kind: "publish" })}>
          {strings.admin.publishBoard}
        </Button>
      </header>
      <p className="admin-pane__note">{strings.admin.houseHowTo}</p>

      {state.status === "loading" ? (
        <PaneLoading />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{strings.admin.failed}</p>
          <Button variant="tonal" icon="refresh" onClick={retry}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : lists.length === 0 && next === null ? (
        <div className="admin__empty">
          <Icon name="public" className="admin__empty-icon" />
          <p className="admin__empty-title">{strings.admin.houseNone}</p>
        </div>
      ) : (
        <ul className="admin-lists__rows">
          {lists.map((list) => (
            <HouseRow
              key={list.id}
              list={list}
              sections={sections}
              narrow={narrow}
              onReplace={() => open({ kind: "replace", list })}
              onTakeDown={() => {
                setTakeDownFailed(false);
                setAsking(list);
              }}
            />
          ))}
        </ul>
      )}
      {moreFailed && (
        <p className="admin__bar" role="alert">
          {strings.admin.failed}
        </p>
      )}
      {state.status === "ready" && next !== null && (
        <Button onClick={() => showMore(next)}>{strings.admin.more}</Button>
      )}

      {picking !== null && (
        <BoardPicker
          picking={picking}
          boards={own}
          narrow={narrow}
          busy={sending}
          failure={failure}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      )}
      {asking !== null && (
        <ConfirmDialog
          title={fill(strings.admin.takeDownAsk, { title: asking.title })}
          body={<p>{strings.admin.takeDownBody}</p>}
          confirmLabel={strings.admin.takeDown}
          busyLabel={strings.admin.takingDown}
          cancelLabel={strings.admin.cancel}
          busy={takingDown}
          narrow={narrow}
          trouble={
            takeDownFailed ? (
              <p className="admin__bar" role="alert">
                {strings.admin.actionFailed}
              </p>
            ) : undefined
          }
          onConfirm={() => takeDown(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
