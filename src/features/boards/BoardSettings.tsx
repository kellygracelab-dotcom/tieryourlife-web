import { useId, useState } from "react";
import { Link } from "react-router";
import { errorOf, type ApiError } from "../../api/errors";
import type { PublishRequest } from "../../api/lists";
import { CATEGORIES, isCategory } from "../../api/types";
import { useSession } from "../../app/session";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { failureText } from "../editor/failureText";
import { isBehind, liveItems, setCover, setPublished, type Board, type DisplayMode } from "./model";
import { publishProblemsOf, publishRequestOf } from "./publish";

export type PublishBoard = (request: PublishRequest) => Promise<{ id: string }>;
export type RepublishBoard = (id: string, request: PublishRequest) => Promise<{ id: string }>;
export type UnpublishBoard = (id: string) => Promise<void>;

export interface PublishingDeps {
  publish: PublishBoard;
  republish: RepublishBoard;
  unpublish: UnpublishBoard;
}

interface BoardSettingsProps {
  board: Board;
  /** The board as it is right now, for a change made after a wait on the network. */
  latest: () => Board;
  keep: (board: Board) => void;
  onCategory: (category: Board["category"]) => void;
  onMode: (mode: DisplayMode) => void;
  /** The board went public, was sent again, or came down; the page says so. */
  onPublished: (what: "published" | "updated" | "unpublished", id: string | null) => void;
  publishing: PublishingDeps;
  onDone: () => void;
  now?: () => number;
}

type Busy = "idle" | "publishing" | "updating" | "unpublishing";

const MAX_COVER = 6;

/**
 * The phone's list settings: the category, how the board is shown, the
 * cover, and whether the board is public. Each change is kept the moment it
 * is made; publishing is the one that waits on the network and says why
 * when it cannot.
 */
export function BoardSettings({
  board,
  latest,
  keep,
  onCategory,
  onMode,
  onPublished,
  publishing,
  onDone,
  now = Date.now,
}: BoardSettingsProps) {
  const id = useId();
  const { account } = useSession();
  const signedIn = account?.kind === "signedIn";
  const [busy, setBusy] = useState<Busy>("idle");
  const [failure, setFailure] = useState<ApiError | null>(null);
  const modes: { mode: DisplayMode; title: string; sub: string }[] = [
    { mode: "WRAP", title: strings.boards.modeWrapped, sub: strings.boards.modeWrappedSub },
    { mode: "RANKED", title: strings.boards.modeRanked, sub: strings.boards.modeRankedSub },
  ];
  const problems = publishProblemsOf(board);
  const isPublic = board.publishedId !== null;
  const behind = isBehind(board);
  const published = isPublic ? `/l/${encodeURIComponent(board.publishedId ?? "")}` : null;

  const send = async (what: "published" | "updated") => {
    const current = latest();
    const request = publishRequestOf(current);
    if (request === null) return;
    setBusy(what === "published" ? "publishing" : "updating");
    setFailure(null);
    try {
      const answer =
        what === "updated" && current.publishedId !== null
          ? await publishing.republish(current.publishedId, request)
          : await publishing.publish(request);
      const name = account?.kind === "signedIn" ? account.displayName : null;
      const after = latest();
      keep(setPublished(after, answer.id, name ?? after.authorName, now()));
      onPublished(what, answer.id);
    } catch (reason: unknown) {
      setFailure(errorOf(reason));
    } finally {
      setBusy("idle");
    }
  };

  const takeDown = async () => {
    const current = latest();
    if (current.publishedId === null) return;
    setBusy("unpublishing");
    setFailure(null);
    try {
      await publishing.unpublish(current.publishedId);
      keep(setPublished(latest(), null, latest().authorName, now()));
      onPublished("unpublished", null);
    } catch (reason: unknown) {
      // Already gone is what was asked for.
      const error = errorOf(reason);
      if (error.kind === "notFound") {
        keep(setPublished(latest(), null, latest().authorName, now()));
        onPublished("unpublished", null);
      } else {
        setFailure(error);
      }
    } finally {
      setBusy("idle");
    }
  };

  // Why the switch cannot be turned on, the first reason in the phone's order.
  const blocker = !signedIn
    ? strings.boards.needsAccount
    : problems.includes("category")
      ? strings.new.needCategory
      : problems.includes("noItems")
        ? strings.boards.needsItems
        : problems.length > 0
          ? strings.new.failedTooLarge.replace("{detail}", "").trim()
          : null;

  const pictures = [
    ...new Set(liveItems(board).flatMap((item) => (item.imageUrl === null ? [] : [item.imageUrl]))),
  ];
  const chosen = board.coverImageUrls;
  const toggleCover = (url: string) => {
    const next = chosen.includes(url) ? chosen.filter((one) => one !== url) : [...chosen, url];
    if (next.length > MAX_COVER) return;
    keep(setCover(latest(), next, now()));
  };

  return (
    <section className="board-panel" aria-labelledby={`${id}-title`}>
      <div className="board-panel__head">
        <h2 id={`${id}-title`}>{strings.boards.settings}</h2>
        <Button onClick={onDone}>{strings.boards.done}</Button>
      </div>

      <div className="board-settings__section">
        <div className="board-settings__row">
          <label className="board-settings__label" htmlFor={`${id}-public`}>
            {strings.boards.publicTitle}
          </label>
          <input
            id={`${id}-public`}
            type="checkbox"
            role="switch"
            className="board-settings__switch"
            checked={isPublic}
            disabled={busy !== "idle" || (!isPublic && blocker !== null)}
            onChange={(event) => void (event.target.checked ? send("published") : takeDown())}
          />
        </div>
        <p className="board-settings__note">{strings.boards.publicBody}</p>
        {!isPublic && blocker !== null && <p className="board-settings__note">{blocker}</p>}
        {busy === "publishing" && (
          <p className="board-settings__note" role="status">
            {strings.boards.publishing}
          </p>
        )}
        {failure !== null && (
          <p className="board-settings__problem" role="alert">
            <Icon name="error" />
            {failureText(failure, isPublic ? "edit" : "new")}
          </p>
        )}
        {isPublic && published !== null && (
          <div className="board-settings__published">
            <div className="board-settings__row">
              <span className="board-settings__label">{strings.boards.publishedVersion}</span>
              <Button
                variant="tonal"
                icon="publish"
                onClick={() => void send("updated")}
                disabled={busy !== "idle" || problems.length > 0}
              >
                {busy === "updating" ? strings.boards.updating : strings.boards.update}
              </Button>
            </div>
            <p className="board-settings__note">
              {behind ? strings.boards.behind : strings.boards.publishedVersionBody}
            </p>
            <Link className="btn btn--text board-settings__open" to={published}>
              <Icon name="open_in_new" className="btn__icon" />
              <span>{strings.new.openList}</span>
            </Link>
          </div>
        )}
      </div>

      <div className="board-settings__section">
        <label className="board-settings__label" htmlFor={`${id}-category`}>
          {strings.boards.category}
        </label>
        <select
          id={`${id}-category`}
          className="board-settings__select"
          value={board.category ?? ""}
          onChange={(event) =>
            onCategory(isCategory(event.target.value) ? event.target.value : null)
          }
        >
          <option value="">{strings.boards.categoryNone}</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {strings.category[category]}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="board-settings__section">
        <legend className="board-settings__label">{strings.boards.cover}</legend>
        <p className="board-settings__note">
          {chosen.length === 0
            ? strings.boards.coverAutomatic
            : chosen.length === 1
              ? strings.boards.coverOne
              : fill(strings.boards.coverCollage, { n: chosen.length })}
        </p>
        {pictures.length === 0 ? (
          <p className="board-settings__note">{strings.boards.coverNoCards}</p>
        ) : (
          <>
            <p className="board-settings__note">
              {fill(strings.boards.coverCards, { n: pictures.length })}
            </p>
            <ul className="board-settings__covers" aria-label={strings.boards.cover}>
              {pictures.map((url) => {
                const card = liveItems(board).find((item) => item.imageUrl === url);
                const on = chosen.includes(url);
                const place = chosen.indexOf(url);
                return (
                  <li key={url}>
                    <button
                      type="button"
                      className={
                        on
                          ? "board-settings__cover board-settings__cover--on"
                          : "board-settings__cover"
                      }
                      aria-pressed={on}
                      aria-label={fill(strings.boards.coverPick, { name: card?.title ?? "" })}
                      disabled={!on && chosen.length >= MAX_COVER}
                      onClick={() => toggleCover(url)}
                    >
                      <img src={url} alt="" loading="lazy" />
                      {on && <span className="board-settings__cover-n">{place + 1}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {chosen.length > 0 && (
              <div>
                <Button icon="undo" onClick={() => keep(setCover(latest(), [], now()))}>
                  {strings.boards.coverReset}
                </Button>
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="board-settings__section">
        <legend className="board-settings__label">{strings.boards.display}</legend>
        <p className="board-settings__note">{strings.boards.displayNote}</p>
        {modes.map(({ mode, title, sub }) => (
          <div key={mode} className="board-settings__mode">
            <input
              id={`${id}-${mode}`}
              type="radio"
              name={`${id}-mode`}
              value={mode}
              checked={board.displayMode === mode}
              onChange={() => onMode(mode)}
            />
            <label className="board-settings__mode-text" htmlFor={`${id}-${mode}`}>
              <span className="board-settings__mode-title">{title}</span>
              <span className="board-settings__mode-sub">{sub}</span>
            </label>
          </div>
        ))}
      </fieldset>
    </section>
  );
}
