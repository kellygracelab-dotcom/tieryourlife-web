import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { errorOf, type ApiError } from "../../api/errors";
import type { Published, PublishRequest } from "../../api/lists";
import type { Topic } from "../../api/sections";
import { useSession } from "../../app/session";
import { loadTopic, loadTopics, withdrawListRanking } from "../../lib/api";
import { IN_APP_BROWSER } from "../../lib/inAppBrowser";
import { holds } from "../../lib/locale";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { onRadioKeys, radioTabIndex } from "../../ui/radioKeys";
import { useModal } from "../../ui/useModal";
import { failureText } from "../editor/failureText";
import type { Section } from "../sections/model";
import {
  MAX_RANKED_TIERS,
  cleanTopicName,
  DISPLAY_MODES,
  isBehind,
  isOut,
  isWaitingTopic,
  liveItems,
  previewsOf,
  rankedTiers,
  setAnonymous,
  setCover,
  setHeld,
  setPublished,
  setRanking,
  setTopic,
  settleTopic,
  topicSent,
  TOPIC_NAME,
  type Board,
  type BoardTopic,
  type DisplayMode,
} from "./model";
import { titleOf } from "./boardText";
import { AS_COMMUNITY } from "./ownList";
import { publishProblemsOf, publishRequestOf } from "./publish";
import { filedUnder, sectionChoices } from "./sectionChoices";
import { sentTopic, settledTopic, type FindTopic } from "./topic";
import "./boards.css";

export type PublishBoard = (request: PublishRequest) => Promise<Published>;
export type RepublishBoard = (id: string, request: PublishRequest) => Promise<Published>;
export type UnpublishBoard = (id: string) => Promise<void>;

export interface PublishingDeps {
  publish: PublishBoard;
  republish: RepublishBoard;
  unpublish: UnpublishBoard;
  /** Takes one's ranking of a list down; the site's own unless told otherwise. */
  withdraw?: (listId: string) => Promise<unknown>;
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
  /** Where the person's own proposals no longer waiting keep their lists, by id. */
  proposalHomes?: Readonly<Record<string, string>>;
  onCategory: (category: string) => void;
  /** Propose a section, from the end of the picker: the page gives the sheet's place to the form. */
  onPropose: () => void;
  onMode: (mode: DisplayMode) => void;
  /** New tier: the page adds one and opens it in the tier editor. */
  onNewTier: () => void;
  /**
   * The board went public, was sent again, or came down; or the backend kept
   * it as one's ranking of the list it was saved from, or kept it out of the
   * feed until a moderator looks (`held`). The page says so.
   */
  onPublished: (
    what: "published" | "updated" | "unpublished" | "ranking" | "held",
    id: string | null,
  ) => void;
  /**
   * How the board goes public under the person's name; null for a board that
   * goes out some other way (a house list), whose sheet then offers none of it.
   */
  publishing: PublishingDeps | null;
  topics?: LoadTopics;
  /** One topic by its id: whether a proposed one still waits. */
  findTopic?: FindTopic;
  onDone: () => void;
  now?: () => number;
}

type Busy = "idle" | "publishing" | "updating" | "unpublishing";
/** A refusal, by the press it answers: each is said beside its own button. */
type Failure = { error: ApiError; on: "publish" | "update" | "takeDown" };
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
  ref,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  ref?: Ref<HTMLButtonElement>;
  /** Whether the picker under the row is open; undefined for a row with nothing under it. */
  open?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
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
  proposalHomes = {},
  onCategory,
  onPropose,
  onMode,
  onNewTier,
  onPublished,
  publishing,
  topics: load = loadTopics,
  findTopic = loadTopic,
  onDone,
  now = Date.now,
}: BoardSettingsProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onDone);
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const [busy, setBusy] = useState<Busy>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  // Why a guest's Public switch did not sign them in, when it could not.
  const [signInNote, setSignInNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>("none");
  const [asking, setAsking] = useState(false);
  const problems = publishProblemsOf(board);
  const ownPublish = publishing !== null;
  const isPublic = ownPublish && isOut(board);
  const behind = isBehind(board);
  // Held for a moderator, the list's link answers 404 to everybody, the author too.
  const held = isPublic && board.heldForReview === true;
  // A ranking is out on the page of the list it ranks.
  const published =
    isPublic && !held
      ? `/l/${encodeURIComponent(board.publishedId ?? board.rankingOf ?? "")}`
      : null;
  const toggle = (which: Open) => setOpen(open === which ? "none" : which);
  // Choosing in a picker closes it and takes away the radio that had the
  // focus, which then fell to the page inside the open sheet: it goes back to
  // the picker's row, now saying what was chosen, as a menu hands it back.
  const categoryRow = useRef<HTMLButtonElement>(null);
  const topicRow = useRef<HTMLButtonElement>(null);
  const closePicker = (row: { current: HTMLButtonElement | null }) => {
    setOpen("none");
    row.current?.focus();
  };

  // A topic of one's own that waits is asked about, as the phone asks when its
  // picker opens; the answer lands only if the board still has that topic.
  const settle = (topic: BoardTopic | null) => {
    if (topic === null || topic.id === null || topic.waiting !== true) return;
    void settledTopic(topic, findTopic).then((decided) => {
      const current = latest();
      if (decided !== topic && current.topic?.id === topic.id) {
        keep(settleTopic(current, decided));
      }
    });
  };

  // The list's topic as the backend kept it, named, while the board still has none of its own.
  const learn = (topicId: string) => {
    findTopic(topicId).then(
      (topic) => {
        const current = latest();
        if (topic.status !== "approved" || current.topic !== null || current.topicOff === true) {
          return;
        }
        keep(settleTopic(current, { id: topic.id, name: topic.name }));
      },
      () => undefined,
    );
  };

  const send = async (what: "published" | "updated") => {
    const current = latest();
    const request = publishRequestOf(current);
    if (request === null || publishing === null) return;
    setBusy(what === "published" ? "publishing" : "updating");
    setFailure(null);
    try {
      // The board's uid goes with every send, as the phone's does: a first
      // publish lost to a reload gets its list back, and a replace keeps it.
      const outgoing = { ...request, boardUid: current.uid };
      let answer =
        what === "updated" && current.publishedId !== null
          ? await publishing.republish(current.publishedId, outgoing)
          : await publishing.publish(outgoing);
      // Out already: an earlier publish made the list and its answer was lost
      // on the way. Nothing of this one was written, so the board goes again
      // over that list's link, or the edits since would never reach it.
      if (answer.existing === true && answer.ranking !== true) {
        answer = await publishing.republish(answer.id, outgoing);
      }
      const name = account?.kind === "signedIn" ? account.displayName : null;
      const after = latest();
      // The cards as they came from the list they were saved from: the
      // backend kept them as one's ranking of it, which has no id of its own.
      const ranking = answer.ranking === true;
      // Kept out of the feed until a moderator looks: its link works for nobody yet.
      const waits = !ranking && answer.underReview === true;
      const out = ranking
        ? setRanking(after, answer.id, now())
        : setHeld(setPublished(after, answer.id, name ?? after.authorName, now()), waits);
      // A name proposed with it is a topic now, waiting for a moderator,
      // unless another was chosen while the request was on its way.
      const sent =
        ranking || after.topic !== current.topic
          ? out
          : settleTopic(
              current.topicOff === true ? topicSent(out) : out,
              sentTopic(current.topic, answer.topicId),
            );
      // A change made while the request was on its way was not in it: the
      // published copy is behind it, and Update still has it to send.
      keep(
        after.editedAt === current.editedAt
          ? sent
          : { ...sent, publishedEditedAt: sent.editedAt - 1 },
      );
      onPublished(ranking ? "ranking" : waits ? "held" : what, answer.id);
      // The backend may have filed it under an approved topic of that name.
      if (sent.topic !== current.topic) settle(sent.topic);
      // Said nothing of a topic, the list kept its own, a moderator's move
      // into one too: the board learns it, as the published copy has it.
      const kept = answer.topicId;
      if (!ranking && sent.topic === null && sent.topicOff !== true && kept) learn(kept);
    } catch (reason: unknown) {
      const error = errorOf(reason);
      // Taken down elsewhere (its page, /me, the phone): the board is no longer
      // public, and its switch says so; turned on, it goes out anew.
      if (what === "updated" && error.kind === "notFound") {
        keep(setPublished(latest(), null, null, now()));
      }
      // A topic of one's own that a moderator turned down meanwhile is not
      // open any more: the board forgets it, and the next try goes without.
      if (error.kind === "invalid" && error.code === "TOPIC_UNAVAILABLE") {
        keep(setTopic(latest(), null, now()));
      }
      setFailure({ error, on: what === "published" ? "publish" : "update" });
    } finally {
      setBusy("idle");
    }
  };

  // Down, the board is one's own again: the name publishing put on it goes, or
  // Your lists would take it for a copy of somebody else's. A ranking down
  // keeps the author's name: the cards are still theirs.
  const down = () => {
    const at = now();
    const was = latest();
    keep(was.rankingOf !== null ? setRanking(was, null, at) : setPublished(was, null, null, at));
    onPublished("unpublished", null);
  };
  const takeDown = async () => {
    const current = latest();
    if (!isOut(current) || publishing === null) return;
    setBusy("unpublishing");
    setFailure(null);
    try {
      if (current.rankingOf !== null) {
        await (publishing.withdraw ?? withdrawListRanking)(current.rankingOf);
      } else if (current.publishedId !== null) {
        await publishing.unpublish(current.publishedId);
      }
      down();
      setAsking(false);
    } catch (reason: unknown) {
      // Already gone is what was asked for.
      const error = errorOf(reason);
      if (error.kind === "notFound") {
        down();
        setAsking(false);
      } else {
        setFailure({ error, on: "takeDown" });
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

  // A guest's switch asks them to sign in; the board stays as it is. Where
  // Google cannot sign anybody in, as in an app's own browser, it says so.
  const onSwitch = () => {
    if (isPublic) setAsking(true);
    else if (!signedIn) {
      setSignInNote(null);
      void signIn().then((outcome) => {
        if (outcome.kind !== "failed") return;
        setSignInNote(
          outcome.code === IN_APP_BROWSER ? strings.keep.inApp : strings.nav.signInFailed,
        );
      });
    } else void send("published");
  };

  // What keeps the board from going out, the first reason in the phone's order.
  const problem = problems.includes("category")
    ? strings.new.needCategory
    : problems.includes("noItems")
      ? strings.boards.needsItems
      : problems.length > 0
        ? strings.new.failedTooLarge
        : null;
  // Why the switch cannot be turned on. Blocked, it stays a Tab stop that
  // says so (aria-disabled), as a disabled input would be skipped unheard.
  const blocker = !signedIn ? strings.boards.needsAccount : problem;
  const blocked = !isPublic && signedIn && blocker !== null;
  const why = !isPublic && blocker !== null ? `${id}-public-why` : undefined;
  const failed = (on: Failure["on"]) =>
    failure !== null && failure.on === on ? (
      <span className="sheet-row__problem" role="alert">
        <Icon name="error" />
        {on === "takeDown"
          ? strings.list.deleteFailed
          : on === "update" && failure.error.kind === "notFound"
            ? strings.new.listGone
            : failure.error.kind === "invalid" && failure.error.code === "TOPIC_UNAVAILABLE"
              ? strings.boards.topicUnavailable
              : failureText(failure.error, on === "update" ? "edit" : "new")}
      </span>
    ) : null;

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
  const choices = sectionChoices(sections, uid).filter(({ name }) => holds(name, find));

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
  // A waiting topic of one's own may have been decided since: asked once per opening.
  const pickerOpen = open === "topic";
  const settleNow = useRef(() => settle(latest().topic));
  useEffect(() => {
    settleNow.current = () => settle(latest().topic);
  });
  useEffect(() => {
    if (pickerOpen) settleNow.current();
  }, [pickerOpen]);
  // One's own, proposed or waiting, is not among the approved ones: it is shown above them.
  const own = isWaitingTopic(board.topic) ? board.topic : null;
  // The topic chosen among those shown; None takes the Tab stop while it is not.
  const topicShown =
    own !== null ||
    (topics.status === "ready" && topics.topics.some((topic) => topic.id === board.topic?.id));
  // A new topic, named here and proposed with the next publish. A name the
  // section already has is that topic, not a twin of it.
  const [naming, setNaming] = useState("");
  const pickTopic = (topic: BoardTopic | null) => {
    keep(setTopic(latest(), topic, now()));
    closePicker(topicRow);
    setNaming("");
  };
  const proposed = cleanTopicName(naming);
  const proposeTopic = () => {
    if (proposed === null) return;
    const known =
      topics.status === "ready"
        ? topics.topics.find((topic) => topic.name.toLowerCase() === proposed.toLowerCase())
        : undefined;
    pickTopic(
      known === undefined ? { id: null, name: proposed } : { id: known.id, name: known.name },
    );
  };
  const topicSub = (topic: BoardTopic | null) =>
    topic === null
      ? strings.boards.topicNone
      : isWaitingTopic(topic)
        ? fill(strings.boards.topicWaiting, { name: topic.name })
        : topic.name;

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
              disabled={tierCount >= MAX_RANKED_TIERS}
              onClick={onNewTier}
            />
          </li>

          {ownPublish && (
            <li className="sheet-row">
              <Row
                icon={<Icon name="public" />}
                title={
                  <label htmlFor={`${id}-public`} className="sheet-row__label">
                    {strings.boards.publicTitle}
                  </label>
                }
                sub={held ? strings.boards.heldBody : strings.boards.publicBody}
                end={
                  <input
                    id={`${id}-public`}
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={isPublic}
                    disabled={busy !== "idle"}
                    aria-disabled={blocked || undefined}
                    aria-describedby={why}
                    onChange={() => {
                      if (!blocked) onSwitch();
                    }}
                  />
                }
              >
                {why !== undefined && (
                  <span id={why} className="sheet-row__note">
                    {blocker}
                  </span>
                )}
                {busy === "publishing" && (
                  <span className="sheet-row__note" role="status">
                    {strings.boards.publishing}
                  </span>
                )}
                {signInNote !== null && !signedIn && (
                  <span className="sheet-row__problem" role="alert">
                    <Icon name="error" />
                    {signInNote}
                  </span>
                )}
                {failed("publish")}
                {!isPublic && failed("update")}
              </Row>
            </li>
          )}

          {ownPublish && (
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
                    // A public list that cannot be sent cannot change either: the reason is under Update.
                    disabled={busy !== "idle" || (isPublic && problem !== null)}
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

          {isPublic && (
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
                {published !== null && (
                  <Link className="sheet-row__link" to={published} state={AS_COMMUNITY}>
                    <Icon name="open_in_new" />
                    <span>{strings.boards.seeInCommunity}</span>
                  </Link>
                )}
                {problem !== null && <span className="sheet-row__note">{problem}</span>}
                {failed("update")}
              </Row>
            </li>
          )}

          <li>
            <RowButton
              ref={categoryRow}
              icon={<Icon name="category" />}
              title={strings.boards.category}
              sub={
                category === null
                  ? strings.boards.categoryNone
                  : filedUnder(category, sections, uid, proposalHomes)
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
                {/* Choosing closes the picker: the arrows only move, and Space or Enter chooses. */}
                {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group */}
                <div
                  role="radiogroup"
                  aria-label={strings.boards.category}
                  onKeyDown={(event) => onRadioKeys(event, false)}
                >
                  {choices.map((section, at) => (
                    <button
                      key={section.id}
                      type="button"
                      role="radio"
                      aria-checked={category === section.id}
                      tabIndex={radioTabIndex(
                        category === section.id,
                        at === 0,
                        !choices.some((one) => one.id === category),
                      )}
                      className="sheet-pick__option"
                      onClick={() => {
                        onCategory(section.id);
                        closePicker(categoryRow);
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
              ref={topicRow}
              icon={<Icon name="label" />}
              title={strings.boards.topic}
              sub={topicSub(board.topic)}
              open={open === "topic"}
              disabled={category === null}
              onClick={() => toggle("topic")}
            />
            {open === "topic" && (
              <div className="sheet-pick">
                {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group */}
                <div
                  className="sheet-pick__options"
                  role="radiogroup"
                  aria-label={strings.boards.topic}
                  onKeyDown={(event) => onRadioKeys(event, false)}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={board.topic === null}
                    tabIndex={board.topic === null || !topicShown ? 0 : -1}
                    className="sheet-pick__option"
                    onClick={() => pickTopic(null)}
                  >
                    {strings.boards.topicNone}
                    {board.topic === null && <Icon name="check" />}
                  </button>
                  {own !== null && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked="true"
                      tabIndex={0}
                      className="sheet-pick__option"
                      onClick={() => closePicker(topicRow)}
                    >
                      <span className="sheet-pick__name">
                        {own.name}
                        <span className="sheet-pick__sub">{strings.boards.topicWaitingShort}</span>
                      </span>
                      <Icon name="check" />
                    </button>
                  )}
                  {topics.status === "ready" &&
                    topics.topics
                      .filter((topic) => own === null || topic.id !== own.id)
                      .map((topic) => (
                        <button
                          key={topic.id}
                          type="button"
                          role="radio"
                          aria-checked={board.topic?.id === topic.id}
                          tabIndex={board.topic?.id === topic.id ? 0 : -1}
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
                {/* A house list is filed by its staff under topics that exist. */}
                {ownPublish && (
                  <form
                    className="sheet-pick__new"
                    onSubmit={(event) => {
                      event.preventDefault();
                      proposeTopic();
                    }}
                  >
                    <input
                      type="text"
                      className="sheet-pick__find"
                      value={naming}
                      maxLength={TOPIC_NAME.max}
                      placeholder={strings.boards.topicNew}
                      aria-label={strings.boards.topicNew}
                      aria-describedby={`${id}-topic-new`}
                      autoComplete="off"
                      onChange={(event) => setNaming(event.target.value)}
                    />
                    <Button type="submit" disabled={proposed === null}>
                      {strings.boards.topicPropose}
                    </Button>
                    <p id={`${id}-topic-new`} className="sheet-pick__note">
                      {strings.boards.topicNewNote}
                    </p>
                  </form>
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
              {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group */}
              <div
                className="segmented"
                role="radiogroup"
                aria-label={strings.boards.display}
                onKeyDown={(event) => onRadioKeys(event)}
              >
                {DISPLAY_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={board.displayMode === mode}
                    tabIndex={board.displayMode === mode ? 0 : -1}
                    className="segmented__option"
                    onClick={() => onMode(mode)}
                  >
                    {board.displayMode === mode && (
                      <Icon name="check" className="segmented__check" />
                    )}
                    <span className="segmented__text">{MODES[mode].title}</span>
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
                  {failed("takeDown")}
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
