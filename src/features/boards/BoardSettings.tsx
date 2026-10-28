import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { errorOf, type ApiError } from "../../api/errors";
import type { PublishRequest } from "../../api/lists";
import type { Topic } from "../../api/sections";
import { useSession } from "../../app/session";
import { loadTopics } from "../../lib/api";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { failureText } from "../editor/failureText";
import type { Section } from "../sections/model";
import {
  BOARD_LIMITS,
  DISPLAY_MODES,
  isBehind,
  liveItems,
  previewsOf,
  rankedTiers,
  setAnonymous,
  setCover,
  setPublished,
  setTopic,
  type Board,
  type BoardTopic,
  type DisplayMode,
} from "./model";
import { titleOf } from "./boardText";
import { publishProblemsOf, publishRequestOf } from "./publish";
import { filedUnder, sectionChoices } from "./sectionChoices";
import "./boards.css";

export type PublishBoard = (request: PublishRequest) => Promise<{ id: string }>;
export type RepublishBoard = (id: string, request: PublishRequest) => Promise<{ id: string }>;
export type UnpublishBoard = (id: string) => Promise<void>;

export interface PublishingDeps {
  publish: PublishBoard;
  republish: RepublishBoard;
  unpublish: UnpublishBoard;
}

/** The approved topics of a section, the biggest first. */
export type LoadTopics = (section: string) => Promise<{ topics: Topic[] }>;

interface BoardSettingsProps {
  board: Board;
  /** The board as it is right now, for a change made after a wait on the network. */
  latest: () => Board;
  keep: (board: Board) => void;
  /** The sections as the site holds them, the person's own waiting ones among them. */
  sections: readonly Section[];
  onCategory: (category: string) => void;
  /** Propose a section, from the end of the picker: the page gives the sheet's place to the form. */
  onPropose: () => void;
  onMode: (mode: DisplayMode) => void;
  /** New tier: the page adds one and opens it in the tier editor. */
  onNewTier: () => void;
  /** The board went public, was sent again, or came down; the page says so. */
  onPublished: (what: "published" | "updated" | "unpublished", id: string | null) => void;
  publishing: PublishingDeps;
  topics?: LoadTopics;
  onDone: () => void;
  now?: () => number;
}

type Busy = "idle" | "publishing" | "updating" | "unpublishing";
type Open = "none" | "category" | "topic" | "cover";
/** What came back for a section's topics. */
type Topics =
  { section: string; status: "ready"; topics: Topic[] } | { section: string; status: "failed" };

const MAX_COVER = 6;

const MODES: Record<DisplayMode, { title: string; sub: string }> = {
  WRAP: { title: strings.boards.modeRows, sub: strings.boards.modeWrappedSub },
  HORIZONTAL_SCROLL: { title: strings.boards.modeStrip, sub: strings.boards.modeStripSub },
  FLAT_RANKED: { title: strings.boards.modeRanking, sub: strings.boards.modeRankedSub },
};

/** One row of the sheet: a 40 px slot for its icon, its words, and whatever ends it. */
function Row({
  icon,
  title,
  sub,
  end,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <span className="sheet-row__icon">{icon}</span>
      <span className="sheet-row__text">
        <span className="sheet-row__title">{title}</span>
        {sub !== undefined && <span className="sheet-row__sub">{sub}</span>}
        {children}
      </span>
      {end}
    </>
  );
}

/** A row that opens a picker under it, or does its one thing. */
function RowButton({
  icon,
  title,
  sub,
  open,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  /** Whether the picker under the row is open; undefined for a row with nothing under it. */
  open?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sheet-row sheet-row--button"
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
    >
      <Row
        icon={icon}
        title={title}
        sub={sub}
        end={
          open !== undefined && (
            <Icon
              name="expand_more"
              className={open ? "sheet-row__more sheet-row__more--open" : "sheet-row__more"}
            />
          )
        }
      />
    </button>
  );
}

/**
 * The phone's list settings as a side sheet: a new tier, whether the list
 * is public, its section and topic, its cover, how the board is shown, and,
 * once public, the way to take it down. Each change is kept the moment it is
 * made; publishing is the one that waits on the network and says why when it
 * cannot.
 */
export function BoardSettings({
  board,
  latest,
  keep,
  sections,
  onCategory,
  onPropose,
  onMode,
  onNewTier,
  onPublished,
  publishing,
  topics: load = loadTopics,
  onDone,
  now = Date.now,
}: BoardSettingsProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onDone);
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const [busy, setBusy] = useState<Busy>("idle");
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<Open>("none");
  const [asking, setAsking] = useState(false);
  const problems = publishProblemsOf(board);
  const isPublic = board.publishedId !== null;
  const behind = isBehind(board);
  const published = isPublic ? `/l/${encodeURIComponent(board.publishedId ?? "")}` : null;
  const toggle = (which: Open) => setOpen(open === which ? "none" : which);

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

  // Down, the board is one's own again: the name publishing put on it goes, or
  // Your lists would take it for a copy of somebody else's.
  const down = () => {
    keep(setPublished(latest(), null, null, now()));
    onPublished("unpublished", null);
  };
  const takeDown = async () => {
    const current = latest();
    if (current.publishedId === null) return;
    setBusy("unpublishing");
    setFailure(null);
    try {
      await publishing.unpublish(current.publishedId);
      down();
      setAsking(false);
    } catch (reason: unknown) {
      // Already gone is what was asked for.
      const error = errorOf(reason);
      if (error.kind === "notFound") {
        down();
        setAsking(false);
      } else {
        setFailure(error);
      }
    } finally {
      setBusy("idle");
    }
  };

  // The question at the end of the sheet takes the eye and the cursor.
  const ask = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!asking) return;
    ask.current?.scrollIntoView?.({ block: "nearest" });
    ask.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);

  // A guest's switch asks them to sign in; the board stays as it is.
  const onSwitch = () => {
    if (isPublic) setAsking(true);
    else if (!signedIn) void signIn();
    else void send("published");
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
  const thumbnail = chosen[0] ?? previewsOf(board, 1)[0] ?? null;

  const [find, setFind] = useState("");
  const uid = account?.kind === "signedIn" ? account.uid : null;
  const choices = sectionChoices(sections, uid).filter(({ name }) =>
    name.toLowerCase().includes(find.trim().toLowerCase()),
  );

  // The section's topics are asked for each time the picker opens; until the
  // answer for this section is in, they are loading.
  const [answer, setAnswer] = useState<Topics | null>(null);
  const category = board.category;
  const topics: Topics | { status: "loading" } =
    answer !== null && answer.section === category ? answer : { status: "loading" };
  useEffect(() => {
    if (open !== "topic" || category === null) return;
    let live = true;
    load(category).then(
      (found) => {
        if (live) setAnswer({ section: category, status: "ready", topics: found.topics });
      },
      () => {
        if (live) setAnswer({ section: category, status: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [open, category, load]);
  const pickTopic = (topic: BoardTopic | null) => {
    keep(setTopic(latest(), topic, now()));
    setOpen("none");
  };

  const tierCount = rankedTiers(board).length;
  const title = titleOf(board);

  return createPortal(
    <div className="sheet-scrim" onClick={onDone}>
      <div
        ref={box}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 id={`${id}-title`} className="sheet__title">
            {strings.boards.settings}
          </h2>
          <Button onClick={onDone}>{strings.boards.done}</Button>
        </div>

        <ul className="sheet__rows">
          <li>
            <RowButton
              icon={<Icon name="add" />}
              title={strings.boards.newTier}
              sub={plural(strings.boards.tierCount, tierCount)}
              disabled={tierCount >= BOARD_LIMITS.tiers}
              onClick={onNewTier}
            />
          </li>

          <li className="sheet-row">
            <Row
              icon={<Icon name="public" />}
              title={
                <label htmlFor={`${id}-public`} className="sheet-row__label">
                  {strings.boards.publicTitle}
                </label>
              }
              sub={strings.boards.publicBody}
              end={
                <input
                  id={`${id}-public`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={isPublic}
                  disabled={busy !== "idle" || (!isPublic && signedIn && blocker !== null)}
                  onChange={onSwitch}
                />
              }
            >
              {!isPublic && blocker !== null && <span className="sheet-row__note">{blocker}</span>}
              {busy === "publishing" && (
                <span className="sheet-row__note" role="status">
                  {strings.boards.publishing}
                </span>
              )}
              {failure !== null && (
                <span className="sheet-row__problem" role="alert">
                  <Icon name="error" />
                  {failureText(failure, isPublic ? "edit" : "new")}
                </span>
              )}
            </Row>
          </li>

          {/* Not for a copy of somebody else's list: its name is theirs to keep or not. */}
          {!(board.authorName !== null && board.publishedId === null) && (
            <li className="sheet-row">
              <Row
                icon={<Icon name="visibility_off" />}
                title={
                  <label htmlFor={`${id}-anonymous`} className="sheet-row__label">
                    {strings.boards.anonymousTitle}
                  </label>
                }
                sub={strings.boards.anonymousBody}
                end={
                  <input
                    id={`${id}-anonymous`}
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={board.anonymous}
                    disabled={busy !== "idle"}
                    onChange={(event) => {
                      keep(setAnonymous(latest(), event.target.checked, now()));
                      // A list already out changes at once, as on the phone.
                      if (isPublic) void send("updated");
                    }}
                  />
                }
              />
            </li>
          )}

          {isPublic && published !== null && (
            <li className="sheet-row">
              <Row
                icon={<Icon name="publish" />}
                title={strings.boards.publishedVersion}
                sub={behind ? strings.boards.behind : strings.boards.publishedVersionBody}
                end={
                  <Button
                    variant="tonal"
                    onClick={() => void send("updated")}
                    disabled={busy !== "idle" || problems.length > 0}
                  >
                    {busy === "updating" ? strings.boards.updating : strings.boards.update}
                  </Button>
                }
              >
                <Link className="sheet-row__link" to={published}>
                  <Icon name="open_in_new" />
                  <span>{strings.new.openList}</span>
                </Link>
              </Row>
            </li>
          )}

          <li>
            <RowButton
              icon={<Icon name="category" />}
              title={strings.boards.category}
              sub={
                category === null
                  ? strings.boards.categoryNone
                  : filedUnder(category, sections, uid)
              }
              open={open === "category"}
              onClick={() => toggle("category")}
            />
            {open === "category" && (
              <div className="sheet-pick">
                <input
                  type="search"
                  className="sheet-pick__find"
                  value={find}
                  placeholder={strings.boards.findSection}
                  aria-label={strings.boards.findSection}
                  autoComplete="off"
                  onChange={(event) => setFind(event.target.value)}
                />
                <div role="radiogroup" aria-label={strings.boards.category}>
                  {choices.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      role="radio"
                      aria-checked={category === section.id}
                      className="sheet-pick__option"
                      onClick={() => {
                        onCategory(section.id);
                        setOpen("none");
                        setFind("");
                      }}
                    >
                      <span className="sheet-pick__name">
                        {section.name}
                        {section.waiting && (
                          <span className="sheet-pick__sub">{strings.boards.categoryWaiting}</span>
                        )}
                      </span>
                      {category === section.id && <Icon name="check" />}
                    </button>
                  ))}
                </div>
                <div>
                  <Button
                    icon="add"
                    onClick={() => {
                      setOpen("none");
                      setFind("");
                      onPropose();
                    }}
                  >
                    {strings.sections.propose}
                  </Button>
                </div>
              </div>
            )}
          </li>

          <li>
            <RowButton
              icon={<Icon name="label" />}
              title={strings.boards.topic}
              sub={board.topic?.name ?? strings.boards.topicNone}
              open={open === "topic"}
              disabled={category === null}
              onClick={() => toggle("topic")}
            />
            {open === "topic" && (
              <div className="sheet-pick" role="radiogroup" aria-label={strings.boards.topic}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={board.topic === null}
                  className="sheet-pick__option"
                  onClick={() => pickTopic(null)}
                >
                  {strings.boards.topicNone}
                  {board.topic === null && <Icon name="check" />}
                </button>
                {topics.status === "ready" &&
                  topics.topics.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      role="radio"
                      aria-checked={board.topic?.id === topic.id}
                      className="sheet-pick__option"
                      onClick={() => pickTopic({ id: topic.id, name: topic.name })}
                    >
                      {topic.name}
                      {board.topic?.id === topic.id && <Icon name="check" />}
                    </button>
                  ))}
                {topics.status === "loading" && (
                  <p className="sheet-pick__note" role="status">
                    {strings.boards.topicsLoading}
                  </p>
                )}
                {topics.status === "failed" && (
                  <p className="sheet-pick__note" role="alert">
                    {strings.boards.topicsFailed}
                  </p>
                )}
              </div>
            )}
          </li>

          <li>
            <RowButton
              icon={
                thumbnail === null ? (
                  <span className="sheet-row__thumb sheet-row__thumb--none" />
                ) : (
                  <img className="sheet-row__thumb" src={thumbnail} alt="" loading="lazy" />
                )
              }
              title={strings.boards.cover}
              sub={chosen.length === 0 ? strings.boards.coverNone : strings.boards.coverChosen}
              open={open === "cover"}
              onClick={() => toggle("cover")}
            />
            {open === "cover" && (
              <div className="sheet-pick sheet-pick--cover">
                <p className="sheet-pick__note">
                  {chosen.length === 0
                    ? strings.boards.coverAutomatic
                    : chosen.length === 1
                      ? strings.boards.coverOne
                      : fill(strings.boards.coverCollage, { n: chosen.length })}
                </p>
                {pictures.length === 0 ? (
                  <p className="sheet-pick__note">{strings.boards.coverNoCards}</p>
                ) : (
                  <>
                    <p className="sheet-pick__note">
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
                              aria-label={fill(strings.boards.coverPick, {
                                name: card?.title ?? "",
                              })}
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
              </div>
            )}
          </li>

          <li className="sheet-row sheet-row--stacked">
            <Row
              icon={<Icon name="view_agenda" />}
              title={strings.boards.display}
              sub={MODES[board.displayMode].sub}
            >
              <div className="segmented" role="radiogroup" aria-label={strings.boards.display}>
                {DISPLAY_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={board.displayMode === mode}
                    className="segmented__option"
                    onClick={() => onMode(mode)}
                  >
                    {board.displayMode === mode && (
                      <Icon name="check" className="segmented__check" />
                    )}
                    {MODES[mode].title}
                  </button>
                ))}
              </div>
            </Row>
          </li>

          {isPublic && (
            <li>
              {asking ? (
                <div ref={ask} className="sheet-ask" role="group" aria-labelledby={`${id}-ask`}>
                  <p id={`${id}-ask`} className="sheet-ask__title">
                    {fill(strings.boards.takeDownTitle, { title })}
                  </p>
                  <p className="sheet-ask__body">{strings.boards.takeDownBody}</p>
                  <div className="sheet-ask__actions">
                    <Button onClick={() => setAsking(false)} disabled={busy !== "idle"}>
                      {strings.rank.cancel}
                    </Button>
                    <Button
                      className="dialog__danger"
                      onClick={() => void takeDown()}
                      disabled={busy !== "idle"}
                    >
                      {strings.boards.takeDown}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="sheet-row sheet-row--button sheet-row--danger"
                  onClick={() => setAsking(true)}
                >
                  <Row icon={<Icon name="visibility_off" />} title={strings.boards.takeDown} />
                </button>
              )}
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
