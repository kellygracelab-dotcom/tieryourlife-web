import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useSession } from "../../app/session";
import { signInFailedText } from "../../app/signInFailure";
import { loadAllTopics, loadTopic } from "../../lib/api";
import type { SignInOutcome } from "../../lib/signIn";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { FocusedPicture } from "../../ui/FocusedPicture";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { useModal } from "../../ui/useModal";
import type { Upload } from "../editor/AddCardBox";
import { failureText } from "../editor/failureText";
import { sectionName, type Section } from "../sections/model";
import { isSectionName, SECTION_NAME_MAX } from "../sections/proposal";
import { isUntitled, titleOf } from "./boardText";
import { rankingFailureText } from "./copyRanking";
import { CoverPicker, CoverSummary } from "./CoverPicker";
import {
  BOARD_LIMITS,
  cleanTopicName,
  isBehind,
  isOut,
  liveItems,
  previewsOf,
  rename,
  setTopic,
  settleTopic,
  TOPIC_NAME,
  type Board,
  type BoardTopic,
} from "./model";
import { AS_COMMUNITY } from "./ownList";
import { publishProblemsOf } from "./publish";
import {
  SectionChips,
  TopicChips,
  topicHeading,
  useSectionTopics,
  type LoadTopics,
} from "./PublishPickers";
import { filedUnder } from "./sectionChoices";
import { settledTopic, type FindTopic } from "./topic";
import {
  publicationActions,
  publishedPath,
  usePublicationState,
  type OnPublished,
  type PublicationState,
  type PublishFailure,
  type PublishingDeps,
} from "./usePublication";
import { runOf } from "./publicationRuns";
import "./boards.css";
import "./publishing.css";
import { cardLabel } from "../../lib/cardText";

export interface PublishWindowProps {
  board: Board;
  /** The board as it is right now, for a change made after a wait on the network. */
  latest: () => Board;
  keep: (board: Board) => void;
  /** The sections as the site holds them, the person's own waiting ones among them. */
  sections: readonly Section[];
  /** Where the person's own proposals no longer waiting keep their lists, by id. */
  proposalHomes?: Readonly<Record<string, string>>;
  onCategory: (category: string) => void;
  /**
   * A new topic to be a section of its own (Continue): the page opens the form
   * to propose a section, with its name and where the list waits filled in,
   * and publishes once it is sent.
   */
  onProposeSection: (name: string, fileUnder: string | null) => void;
  onPublished: OnPublished;
  /** Where a publish stands, the page's own, so the header's button shows it too. */
  publication?: PublicationState;
  publishing: PublishingDeps;
  topics?: LoadTopics;
  /** One topic by its id: whether a proposed one still waits. */
  findTopic?: FindTopic;
  onClose: () => void;
  /**
   * Publish and Update go on in the background once pressed (BRIEF, 1 and 7):
   * the window closes at once, and the page opens it again on a refusal, to
   * say what it was. Without it, the window waits for the answer.
   */
  onRefused?: () => void;
  now?: () => number;
  /** Opened to go on at once, as Publish was pressed: after a sign-in, or a section proposed. */
  start?: boolean;
  /**
   * A guest's Publish: signs in, and the page opens the window on Publish
   * again once the account is there. Without it, the window only signs in.
   */
  signInToPublish?: () => Promise<SignInOutcome>;
  /** Where a photo of one's own for the cover goes. */
  upload?: Upload;
}

/** What a refusal says, by the press it answers. */
function failureOf(failure: PublishFailure, board: Board): string {
  if (failure.on === "takeDown") return strings.list.deleteFailed;
  if (failure.on === "update" && failure.error.kind === "notFound") return strings.new.listGone;
  if (failure.ranking !== undefined) return rankingFailureText(failure.error, failure.ranking);
  if (failure.error.kind === "invalid" && failure.error.code === "TOPIC_UNAVAILABLE") {
    return strings.boards.topicUnavailable;
  }
  return failureText(failure.error, failure.on === "update" ? "edit" : "new", (url) => {
    const card = liveItems(board).find((item) => item.imageUrl === url);
    return card === undefined ? null : cardLabel(card.title);
  });
}

/** What keeps the board from going out, the first reason in the phone's order; null when nothing does. */
function problemOf(board: Board): string | null {
  const problems = publishProblemsOf(board);
  if (problems.length === 0) return null;
  if (problems.includes("noItems")) return strings.boards.needsItems;
  if (problems.includes("tooManyTiers")) return strings.new.tooManyTiers;
  return strings.new.failedTooLarge;
}

/** A line that stops the press, said above the window's buttons. */
function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="publish-window__alert" role="alert">
      <Icon name="error" />
      <span>{children}</span>
    </p>
  );
}

/** The one explanation of what happens, once, before the buttons. */
function How({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="publish-window__how">
      <Icon name={icon} />
      <span>{children}</span>
    </p>
  );
}

/** The window's main button: its ring while the press is on its way, in place of the icon. */
function GoButton({
  icon,
  busy,
  busyWord,
  filled = true,
  onClick,
  children,
}: {
  icon: IconName;
  busy: boolean;
  busyWord: string;
  filled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn ${filled ? "btn--filled" : "btn--tonal"} publish-window__go`}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? (
        <span className="publish-ring" aria-hidden="true" />
      ) : (
        <Icon name={icon} className="btn__icon" />
      )}
      <span>{busy ? busyWord : children}</span>
    </button>
  );
}

/**
 * One window for publishing a board (Danylo's canvas, 16.11.2026): its
 * section, an optional topic or one proposed, one line on how it goes out,
 * and Publish. Publish is never greyed out: without a section it says so
 * there and puts the cursor in the search. A copy of somebody else's list
 * goes into that list's Rankings instead (Show in Rankings); a list already
 * out shows where it is, its section and topic to change, Update, and Take
 * it down. Each choice is kept the moment it is made, so a window closed
 * without publishing opens on it again; the window closes by itself once
 * the list is out, and the page says so under the board.
 */
/** The name field of an untitled list, where the window opens. */
const NAME_INPUT = ".publish-window__input--name";

export function PublishWindow({
  board,
  latest,
  keep,
  sections,
  proposalHomes = {},
  onCategory,
  onProposeSection,
  onPublished,
  publication,
  publishing,
  topics: load = loadAllTopics,
  findTopic = loadTopic,
  onClose,
  onRefused,
  now = Date.now,
  start = false,
  signInToPublish,
  upload,
}: PublishWindowProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // The cover, changed as a step of the window: Escape and Back come back to
  // publishing, with the section and topic as they were.
  const [coverStep, setCoverStep] = useState(false);
  const coverChange = useRef<HTMLButtonElement>(null);
  const leaveCover = () => setCoverStep(false);
  // An untitled list opens on its name, the cursor in it (artboard 19); read once, so the focus stays put as it is named.
  const [openedUntitled] = useState(() => isUntitled(board));
  useModal(box, coverStep ? leaveCover : onClose, openedUntitled ? NAME_INPUT : undefined);
  const wasCover = useRef(coverStep);
  useEffect(() => {
    if (wasCover.current === coverStep) return;
    wasCover.current = coverStep;
    if (coverStep) box.current?.querySelector<HTMLElement>(".publish-window__back")?.focus();
    else coverChange.current?.focus();
  }, [coverStep]);
  const { account, signIn } = useSession();
  const me = account?.kind === "signedIn" ? account : null;
  const uid = me?.uid ?? null;
  const ownState = usePublicationState(`${board.uid}:${uid ?? ""}`);
  const state = publication ?? ownState;
  const { busy, failure, rankInstead, setRankInstead, setFailure } = state;
  const { send, rankCopy, takeDown } = publicationActions(state, {
    latest,
    keep,
    publishing,
    account,
    onPublished,
    now,
    findTopic,
  });

  // Closed while a press is on its way, the window is not there to close
  // again once it lands: the page may show something else by then.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const closeOnce = (out: boolean) => {
    if (out && open.current) onClose();
  };
  // Sent on in the background: the window goes at once, and comes back only
  // to say a refusal (BRIEF, 1 and 7). A page that cannot bring it back
  // keeps it open until the answer, as before.
  const sendOn = (what: "published" | "updated") => {
    if (onRefused === undefined) {
      void send(what).then(closeOnce);
      return;
    }
    void send(what).then((out) => {
      if (!out && runOf(state.key).failure !== null) onRefused();
    });
    onClose();
  };

  const isPublic = isOut(board);
  const behind = isBehind(board);
  const held = isPublic && board.heldForReview === true;
  // New, out by its link and waiting for staff before the feed (Danylo, 26.11.2026).
  const awaiting = isPublic && !held && board.awaitingApproval === true;
  // Somebody else's list's copy, not out: it goes into that list's Rankings.
  const copyOf = !isPublic && board.takenFrom !== null ? board.takenFrom : null;
  const rankingOf = rankInstead ?? copyOf;
  const view: "publish" | "rank" | "out" =
    rankingOf !== null ? "rank" : isPublic ? "out" : "publish";
  const published = publishedPath(board);
  const title = titleOf(board);
  const category = board.category;
  const busyNow = busy !== "idle";

  // A list out: its section or its topic opened to change, and Take it down asked about.
  const [changing, setChanging] = useState<"none" | "section" | "topic">("none");
  const [asking, setAsking] = useState(false);
  // Publish pressed with no section: the section block says so.
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // An untitled list is named first, at the top of the window (audit D1).
  const untitled = isUntitled(board);
  const [named, setNamed] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  // Why a guest's Publish did not sign them in, when it could not.
  const [signInNote, setSignInNote] = useState<string | null>(null);
  // A topic being named here (null while the field is closed), or a section.
  const [naming, setNaming] = useState<string | null>(null);
  const [asSection, setAsSection] = useState(false);
  const find = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const topicsShown = view === "publish" || changing === "topic";
  const topics = useSectionTopics(category, load, topicsShown && category !== null);

  // A topic of one's own that waits is asked about as the window opens; the
  // answer lands only if the board still has that topic.
  const settleOnOpen = useRef(() => {
    const topic = latest().topic;
    if (topic === null || topic.id === null || topic.waiting !== true) return;
    void settledTopic(topic, findTopic).then((decided) => {
      const current = latest();
      if (decided !== topic && current.topic?.id === topic.id) keep(settleTopic(current, decided));
    });
  });
  useEffect(() => settleOnOpen.current(), []);

  const chooseSection = (section: string) => {
    if (section !== latest().category) onCategory(section);
    setTried(false);
    setProblem(null);
    if (view === "out") setChanging("none");
  };
  const pickTopic = (topic: BoardTopic | null) => {
    keep(setTopic(latest(), topic, now()));
    if (view === "out") setChanging("none");
  };
  // A name the section already has is that topic, not a twin of it.
  const proposed = naming === null ? null : cleanTopicName(naming);
  const addTopic = () => {
    if (proposed === null) return false;
    const known =
      topics.status === "ready"
        ? topics.topics.find((one) => one.name.toLowerCase() === proposed.toLowerCase())
        : undefined;
    pickTopic(
      known === undefined ? { id: null, name: proposed } : { id: known.id, name: known.name },
    );
    setNaming(null);
    return true;
  };

  // A guest's press signs them in; the page opens the window again once they
  // are, and it goes on by itself. Where Google cannot sign anybody in, as in
  // an app's own browser, it says so.
  const signInFirst = () => {
    setSignInNote(null);
    void (signInToPublish ?? signIn)().then((outcome) => {
      if (outcome.kind !== "failed") return;
      setSignInNote(signInFailedText(outcome.code));
    });
  };

  const sectionMissing = () => {
    setTried(true);
    find.current?.focus();
  };

  // Continue for a section of one's own: the form, never a publication. A
  // guest signs in here without the page's publish-after-sign-in, which would
  // open a new window and publish the list in the parent section.
  const propose = (name: string) => {
    if (latest().category === null) {
      sectionMissing();
      return;
    }
    if (!isSectionName(name)) {
      nameField.current?.focus();
      return;
    }
    if (me !== null) {
      onProposeSection(name, latest().category);
      return;
    }
    setSignInNote(null);
    void signIn().then((outcome) => {
      if (outcome.kind === "signedIn") onProposeSection(name, latest().category);
      else if (outcome.kind === "failed") setSignInNote(signInFailedText(outcome.code));
    });
  };

  // The name typed in the window, kept on the board before anything else: a
  // guest's sign-in comes back to a board with its name.
  const nameFirst = (): boolean => {
    if (!isUntitled(latest())) return true;
    const name = named.replace(/\s+/g, " ").trim();
    if (name === "") {
      setNameMissing(true);
      nameInput.current?.focus();
      return false;
    }
    keep(rename(latest(), name, now()));
    return true;
  };

  // Publish, or Continue for a section of one's own.
  const go = () => {
    if (busyNow) return;
    if (!nameFirst()) return;
    if (asSection && naming !== null) {
      propose(naming.replace(/\s+/g, " ").trim());
      return;
    }
    if (me === null) {
      signInFirst();
      return;
    }
    if (latest().category === null) {
      sectionMissing();
      return;
    }
    // A topic typed and not yet added goes with the list, as Add would have it.
    if (naming !== null) addTopic();
    const problem = problemOf(latest());
    setProblem(problem);
    if (problem === null) sendOn("published");
  };

  const rank = () => {
    if (busyNow) return;
    if (me === null) {
      signInFirst();
      return;
    }
    if (rankInstead === null) sendOn("published");
    else void rankCopy(rankInstead).then(closeOnce);
  };

  const update = () => {
    if (busyNow) return;
    const problem = problemOf(latest());
    setProblem(problem);
    if (problem === null) sendOn("updated");
  };

  // Opened to go on at once: once, as soon as the window is up. A render
  // before the timer fires (the board kept, the sections in) puts it off to
  // the next one, with that render's own press; it is not lost.
  const started = useRef(false);
  useEffect(() => {
    if (!start || started.current) return;
    const timer = setTimeout(() => {
      started.current = true;
      if (view === "publish") go();
      else if (view === "rank") rank();
    });
    return () => clearTimeout(timer);
  });

  // Take it down asks first, and the cursor goes to the question.
  const ask = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asking) ask.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);

  // The cursor goes into the field Propose a topic opens.
  const namingOpen = naming !== null;
  useEffect(() => {
    if (namingOpen) nameField.current?.focus();
  }, [namingOpen]);

  const said = failure !== null ? failureOf(failure, board) : null;
  const notes = (
    <>
      {signInNote !== null && me === null && <Alert>{signInNote}</Alert>}
      {problem !== null && <Alert>{problem}</Alert>}
      {said !== null && <Alert>{said}</Alert>}
    </>
  );

  const cards = plural(strings.boards.cards, liveItems(board).length);
  const name = me?.displayName ?? null;
  const meta = name === null ? cards : `${cards} · ${fill(strings.publishWindow.by, { name })}`;
  const sectionLabel =
    category === null ? null : filedUnder(category, sections, uid, proposalHomes);

  const head = (heading: string, sub: ReactNode) => (
    <div className="publish-window__head">
      <div className="publish-window__heading">
        <h2 id={`${id}-title`} className="publish-window__title">
          {heading}
        </h2>
        <p className="publish-window__meta">{sub}</p>
      </div>
      <button
        type="button"
        className="publish-window__close"
        aria-label={strings.publishWindow.close}
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
    </div>
  );

  // A guest is told first, before choosing anything, that the press signs them in (audit D1).
  const guestNote =
    me === null ? (
      <p className="publish-window__guest">
        <Icon name="person" />
        <span>{strings.publishWindow.needsAccount}</span>
      </p>
    ) : null;

  // What Community will show, at the top of the window: not for a ranking,
  // which is shown under somebody else's list and not as a card of its own.
  const cover =
    board.rankingOf === null ? (
      <CoverSummary board={board} onChange={() => setCoverStep(true)} changeRef={coverChange} />
    ) : null;

  let content: ReactNode;
  if (coverStep && view !== "rank") {
    content = (
      <>
        <div className="publish-window__head">
          <button
            type="button"
            className="publish-window__close publish-window__back"
            aria-label={strings.publishWindow.coverBack}
            onClick={leaveCover}
          >
            <Icon name="arrow_back" />
          </button>
          <div className="publish-window__heading">
            <h2 id={`${id}-title`} className="publish-window__title">
              {strings.boards.cover}
            </h2>
            <p className="publish-window__meta">{title}</p>
          </div>
        </div>
        <div className="publish-window__body">
          <CoverPicker board={board} latest={latest} keep={keep} upload={upload} now={now} />
        </div>
        <div className="dialog__actions">
          <Button variant="filled" onClick={leaveCover}>
            {strings.boards.done}
          </Button>
        </div>
      </>
    );
  } else if (view === "rank") {
    const picture = previewsOf(board, 1)[0] ?? null;
    content = (
      <>
        {head(strings.rankings.progressShare, strings.publishWindow.rankSub)}
        <fieldset className="publish-window__body" disabled={busyNow}>
          {guestNote}
          <div className="publish-window__original">
            {picture === null ? (
              <span className="publish-window__thumb publish-window__thumb--none" />
            ) : (
              <FocusedPicture className="publish-window__thumb" src={picture} focus={null} />
            )}
            <span className="publish-window__original-text">
              <Link to={`/l/${encodeURIComponent(rankingOf ?? "")}?rankings=1`}>{title}</Link>
              {board.authorName !== null && (
                <span className="publish-window__meta">
                  {fill(strings.publishWindow.by, { name: board.authorName })}
                </span>
              )}
            </span>
          </div>
          {rankInstead !== null && (
            <p className="publish-window__note">{strings.rankings.notYours}</p>
          )}
          {failure === null && <How icon="leaderboard">{strings.publishWindow.rankHow}</How>}
        </fieldset>
        {notes}
        <div className="dialog__actions">
          {!busyNow && (
            <Button
              onClick={() => {
                setRankInstead(null);
                setFailure(null);
                onClose();
              }}
            >
              {strings.publishWindow.cancel}
            </Button>
          )}
          <GoButton
            icon="leaderboard"
            busy={busyNow}
            busyWord={strings.boards.publishing}
            onClick={rank}
          >
            {me === null ? strings.publishWindow.signInAndShow : strings.rankings.progressShare}
          </GoButton>
        </div>
      </>
    );
  } else if (view === "out") {
    const ranking = board.rankingOf !== null;
    content = (
      <>
        {head(
          title,
          <span className="publish-window__status">
            <Icon name={held || awaiting ? "schedule" : "check_circle"} />
            {held
              ? strings.boards.heldBody
              : awaiting
                ? strings.boards.awaitingApproval
                : ranking
                  ? strings.boards.inRankingsStatus
                  : strings.boards.publishedStatus}
          </span>,
        )}
        {/* An Update on its way leaves Take it down to be pressed: it stops the
            Update (publish-update-speed BRIEF, 6). What it would change waits. */}
        <fieldset className="publish-window__body" disabled={busyNow && busy !== "updating"}>
          {cover}
          <dl className="publish-window__rows">
            {!ranking && (
              <>
                <div className="publish-window__row">
                  <dt>{strings.publishWindow.section}</dt>
                  <dd>{sectionLabel ?? strings.boards.categoryNone}</dd>
                  <button
                    type="button"
                    className="publish-window__change"
                    aria-expanded={changing === "section"}
                    aria-label={strings.publishWindow.changeSection}
                    disabled={busy === "updating"}
                    onClick={() => setChanging(changing === "section" ? "none" : "section")}
                  >
                    {strings.publishWindow.change}
                  </button>
                </div>
                {changing === "section" && (
                  <div className="publish-window__pick">
                    <SectionChips
                      sections={sections}
                      uid={uid}
                      chosen={category}
                      onChoose={chooseSection}
                      label={strings.publishWindow.section}
                      find={find}
                    />
                  </div>
                )}
                <div className="publish-window__row">
                  <dt>{strings.boards.topic}</dt>
                  <dd>{board.topic?.name ?? strings.boards.topicNone}</dd>
                  <button
                    type="button"
                    className="publish-window__change"
                    aria-expanded={changing === "topic"}
                    aria-label={strings.publishWindow.changeTopic}
                    disabled={category === null || busy === "updating"}
                    onClick={() => setChanging(changing === "topic" ? "none" : "topic")}
                  >
                    {strings.publishWindow.change}
                  </button>
                </div>
                {changing === "topic" && (
                  <div className="publish-window__pick">
                    <TopicChips
                      topic={board.topic}
                      topics={topics}
                      onPick={pickTopic}
                      label={topicHeading(sectionLabel)}
                    />
                  </div>
                )}
              </>
            )}
            <div className="publish-window__row">
              <dt>{strings.publishWindow.version}</dt>
              <dd className={behind ? "publish-window__behind" : undefined}>
                {behind ? strings.boards.behind : strings.publishWindow.upToDate}
              </dd>
            </div>
          </dl>
          {asking ? (
            <div
              ref={ask}
              className="sheet-ask publish-window__ask"
              role="group"
              aria-labelledby={`${id}-ask`}
            >
              <p id={`${id}-ask`} className="sheet-ask__title">
                {fill(strings.boards.takeDownTitle, { title })}
              </p>
              <p className="sheet-ask__body">{strings.boards.takeDownBody}</p>
              <div className="sheet-ask__actions">
                <Button onClick={() => setAsking(false)}>{strings.rank.cancel}</Button>
                <Button className="dialog__danger" onClick={() => void takeDown().then(closeOnce)}>
                  {busy === "unpublishing"
                    ? strings.publishWindow.takingDown
                    : strings.boards.takeDown}
                </Button>
              </div>
            </div>
          ) : (
            // A plain button and what it does in a line under it: in a tinted
            // block it read as a warning, not as something to press (Danylo's
            // walk, 25.11). The question after it is where the danger is said.
            <div className="publish-window__down">
              <Button
                variant="outlined"
                aria-describedby={`${id}-down-note`}
                onClick={() => setAsking(true)}
              >
                {strings.boards.takeDown}
              </Button>
              <p id={`${id}-down-note`} className="publish-window__note">
                {strings.boards.takeDownBody}
              </p>
            </div>
          )}
        </fieldset>
        {notes}
        <div className="dialog__actions">
          {published !== null && (
            <Link className="btn btn--outlined" to={published} state={AS_COMMUNITY}>
              <Icon name="open_in_new" className="btn__icon" />
              {/* The Share menu's name for the same way there: one action, one name (Danylo's walk, 25.11). */}
              <span>{strings.share.openInCommunity}</span>
            </Link>
          )}
          {behind || busy === "updating" ? (
            <GoButton
              icon="cloud_upload"
              busy={busy === "updating"}
              busyWord={strings.boards.updating}
              onClick={update}
            >
              {strings.boards.update}
            </GoButton>
          ) : (
            <Button variant="tonal" onClick={onClose}>
              {strings.boards.done}
            </Button>
          )}
        </div>
      </>
    );
  } else {
    const max = asSection ? SECTION_NAME_MAX : TOPIC_NAME.max;
    const typed = naming ?? "";
    content = (
      <>
        {head(
          untitled
            ? strings.publishWindow.titleUntitled
            : fill(strings.publishWindow.title, { title }),
          meta,
        )}
        <fieldset className="publish-window__body" disabled={busyNow}>
          {guestNote}
          {untitled && (
            <section className="publish-window__block" aria-labelledby={`${id}-name-label`}>
              <label
                id={`${id}-name-label`}
                htmlFor={`${id}-name`}
                className="publish-window__label"
              >
                {strings.publishWindow.name}
              </label>
              <span className="publish-window__field">
                <input
                  ref={nameInput}
                  id={`${id}-name`}
                  type="text"
                  className="publish-window__input publish-window__input--name"
                  value={named}
                  maxLength={BOARD_LIMITS.title}
                  placeholder={strings.publishWindow.namePlaceholder}
                  aria-invalid={nameMissing || undefined}
                  aria-describedby={
                    nameMissing ? `${id}-name-hint ${id}-name-missing` : `${id}-name-hint`
                  }
                  autoComplete="off"
                  onChange={(event) => {
                    setNamed(event.target.value);
                    setNameMissing(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      go();
                    }
                  }}
                />
              </span>
              <p id={`${id}-name-hint`} className="publish-window__hint">
                {fill(strings.publishWindow.nameHint, { untitled: strings.boards.untitled })}
              </p>
              {nameMissing && (
                <p id={`${id}-name-missing`} className="publish-window__missing" role="alert">
                  <Icon name="error" />
                  {strings.publishWindow.nameFirst}
                </p>
              )}
            </section>
          )}
          {cover}
          <section
            className={
              tried
                ? "publish-window__block publish-window__block--missing"
                : "publish-window__block"
            }
            aria-labelledby={`${id}-section`}
          >
            <h3 id={`${id}-section`} className="publish-window__label">
              {asSection ? strings.publishWindow.sectionWaits : strings.publishWindow.section}
            </h3>
            {tried && (
              <p id={`${id}-missing`} className="publish-window__missing" role="alert">
                <Icon name="error" />
                {strings.publishWindow.pickSection}
              </p>
            )}
            <SectionChips
              sections={sections}
              uid={uid}
              chosen={category}
              onChoose={chooseSection}
              label={strings.publishWindow.section}
              find={find}
              describedBy={tried ? `${id}-missing` : undefined}
            />
          </section>

          <section className="publish-window__block" aria-labelledby={`${id}-topic`}>
            <h3 id={`${id}-topic`} className="publish-window__label">
              {topicHeading(category === null ? null : sectionName(category, sections))}
            </h3>
            {category === null ? (
              <p className="publish-window__note">{strings.publishWindow.topicFirst}</p>
            ) : (
              <TopicChips
                topic={board.topic}
                topics={topics}
                onPick={pickTopic}
                label={strings.boards.topic}
              >
                {naming === null && (
                  <button
                    type="button"
                    className="chip publish-chip publish-chip--new"
                    onClick={() => setNaming("")}
                  >
                    <Icon name="add" className="chip__icon" />
                    <span>{strings.publishWindow.proposeTopic}</span>
                  </button>
                )}
              </TopicChips>
            )}
            {category !== null && naming !== null && (
              <form
                className="publish-window__naming"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (asSection) go();
                  else addTopic();
                }}
              >
                <span className="publish-window__field">
                  <input
                    ref={nameField}
                    type="text"
                    className="publish-window__input"
                    value={typed}
                    maxLength={max}
                    aria-label={
                      asSection ? strings.publishWindow.newSection : strings.boards.topicNew
                    }
                    aria-describedby={`${id}-naming`}
                    autoComplete="off"
                    onChange={(event) => setNaming(event.target.value)}
                  />
                  <span className="publish-window__count" aria-hidden="true">
                    {typed.length}/{max}
                  </span>
                </span>
                {!asSection && (
                  <Button type="submit" variant="outlined" disabled={proposed === null}>
                    {strings.publishWindow.add}
                  </Button>
                )}
                <label className="publish-window__check">
                  <input
                    type="checkbox"
                    checked={asSection}
                    onChange={(event) => setAsSection(event.target.checked)}
                  />
                  <span>{strings.publishWindow.asSection}</span>
                </label>
                <p
                  id={`${id}-naming`}
                  className={
                    asSection
                      ? "publish-window__how publish-window__how--section"
                      : "publish-window__note"
                  }
                >
                  {asSection && <Icon name="add_photo_alternate" />}
                  <span>
                    {fill(
                      asSection
                        ? strings.publishWindow.sectionNote
                        : strings.publishWindow.topicNote,
                      {
                        section: category === null ? "" : sectionName(category, sections),
                      },
                    )}
                  </span>
                </p>
              </form>
            )}
          </section>
          {failure === null && <How icon="public">{strings.publishWindow.how}</How>}
        </fieldset>
        {notes}
        <div className="dialog__actions">
          {!busyNow && (
            <Button
              onClick={() => {
                setFailure(null);
                onClose();
              }}
            >
              {strings.publishWindow.cancel}
            </Button>
          )}
          {asSection && naming !== null ? (
            <Button variant="filled" icon="chevron_right" onClick={go}>
              {strings.publishWindow.continue}
            </Button>
          ) : (
            <GoButton
              icon="publish"
              busy={busyNow}
              busyWord={strings.boards.publishing}
              onClick={go}
            >
              {me === null ? strings.publishWindow.signInAndPublish : strings.new.publish}
            </GoButton>
          )}
        </div>
      </>
    );
  }

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog publish-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={busyNow || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </div>
    </div>,
    document.body,
  );
}
