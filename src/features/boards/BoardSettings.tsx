import { MediaImage } from "../../ui/MediaImage";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { creditAsAttribution, type EditorCredit } from "../../api/pictureAttribution";
import type { Topic } from "../../api/sections";
import { useSession } from "../../app/session";
import { loadAllTopics, loadTopic } from "../../lib/api";
import { fieldsOf } from "../../lib/editorCredit";
import { IN_APP_BROWSER } from "../../lib/inAppBrowser";
import type { SignInOutcome } from "../../lib/signIn";
import { holds } from "../../lib/locale";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { CoverAdjust } from "../../ui/CoverAdjust";
import { FocusedPicture } from "../../ui/FocusedPicture";
import { Icon } from "../../ui/Icon";
import { onRadioKeys, radioTabIndex } from "../../ui/radioKeys";
import { useModal } from "../../ui/useModal";
import { pictureFailureText, type Upload } from "../editor/AddCardBox";
import { uploadPicture } from "../../lib/pictures";
import { failureText } from "../editor/failureText";
import type { Section } from "../sections/model";
import { PictureRows } from "../tierboard/AboutPicture";
import { CreditForm } from "../tierboard/CreditForm";
import {
  MAX_RANKED_TIERS,
  cleanTopicName,
  coverCreditOf,
  coverFocusOf,
  DISPLAY_MODES,
  isBehind,
  isOut,
  isWaitingTopic,
  liveItems,
  previewsOf,
  rankedTiers,
  setCover,
  setCoverCredit,
  setCoverFocus,
  setTopic,
  settleTopic,
  TOPIC_NAME,
  type Board,
  type BoardTopic,
  type DisplayMode,
} from "./model";
import { titleOf } from "./boardText";
import { AS_COMMUNITY } from "./ownList";
import { publishProblemsOf } from "./publish";
import { rankingFailureText } from "./copyRanking";
import { filedUnder, sectionChoices } from "./sectionChoices";
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
import "./boards.css";

export type {
  PublishBoard,
  PublishingDeps,
  RepublishBoard,
  UnpublishBoard,
} from "./usePublication";

/**
 * The approved topics of a section, the biggest first: every one of them,
 * page by page. The first page alone left out a topic made today, with no
 * list yet, once a section had more than twenty (Content, 15.11.2026).
 */
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
  onPublished: OnPublished;
  /**
   * Where a publish stands, the page's own: a refusal met by the header's
   * button is read here. The sheet keeps one of its own without it.
   */
  publication?: PublicationState;
  /**
   * How the board goes public under the person's name; null for a board that
   * goes out some other way (a house list), whose sheet then offers none of it.
   */
  publishing: PublishingDeps | null;
  /** A house board: its cover of one picture takes the editor's own credit here. */
  house?: boolean;
  upload?: Upload;
  topics?: LoadTopics;
  /** One topic by its id: whether a proposed one still waits. */
  findTopic?: FindTopic;
  onDone: () => void;
  now?: () => number;
  /**
   * Opened from the board's header or ⋮ menu for one of these: the sheet
   * starts it at once, as its own button would (Publish or Show in Rankings,
   * Update, Take it down).
   */
  start?: SettingsStart;
  /**
   * A guest's Publish: signs in, and the page opens the sheet on Publish again
   * once the account is there, so the publish goes on by itself. Without it,
   * the sheet only signs in.
   */
  signInToPublish?: () => Promise<SignInOutcome>;
}

/**
 * What the sheet opens on: Publish, Update or Take it down from the ⋮ menu
 * starts it; `publication` only shows the Publication row, where the reason
 * the header's button could not go on is said (Danylo, 16.11.2026).
 */
export type SettingsStart = "publish" | "update" | "takeDown" | "publication";

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
/**
 * About the cover picture, on a house board: the editor's own credit for a
 * cover of one picture, shown as About the picture shows a card's, and
 * given, changed or taken off here. It goes out with the next publish or
 * update, and stays with this cover only.
 */
function CoverCreditPanel({
  credit,
  onCredit,
}: {
  credit: EditorCredit | null;
  onCredit: (credit: EditorCredit | null) => void;
}) {
  const [form, setForm] = useState(false);
  const attribution = credit === null ? null : creditAsAttribution(credit);
  return (
    <section className="board-settings__credit" aria-label={strings.credit.coverAbout}>
      <p className="sheet-pick__note">{strings.credit.coverAbout}</p>
      {form ? (
        <CreditForm
          catalogue
          initial={fieldsOf(attribution)}
          editing={{
            save: onCredit,
            remove: credit === null ? undefined : () => onCredit(null),
          }}
          onDone={() => setForm(false)}
        />
      ) : (
        <>
          <PictureRows attribution={attribution} />
          <Button icon="edit" onClick={() => setForm(true)}>
            {credit === null ? strings.credit.add : strings.credit.edit}
          </Button>
        </>
      )}
    </section>
  );
}

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
  house = false,
  upload = uploadPicture,
  topics: load = loadAllTopics,
  findTopic = loadTopic,
  onDone,
  now = Date.now,
  start,
  signInToPublish,
  publication,
}: BoardSettingsProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onDone);
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const ownState = usePublicationState(`${board.uid}:${signedIn ? account.uid : ""}`);
  const state = publication ?? ownState;
  const { busy, failure, rankInstead, setRankInstead } = state;
  const { send, rankCopy, takeDown } = publicationActions(state, {
    latest,
    keep,
    publishing,
    account,
    onPublished,
    now,
    findTopic,
  });
  // Why a guest's Publish did not sign them in, when it could not.
  const [signInNote, setSignInNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>("none");
  // Take it down from the ⋮ menu opens on its question.
  const [asking, setAsking] = useState(
    () => start === "takeDown" && publishing !== null && isOut(board),
  );
  const problems = publishProblemsOf(board);
  const ownPublish = publishing !== null;
  const isPublic = ownPublish && isOut(board);
  const behind = isBehind(board);
  // Somebody else's list's copy, or one's ranking out: it goes into a list's Rankings.
  const ranks =
    board.rankingOf !== null || (board.takenFrom !== null && board.publishedId === null);
  // Held for a moderator, the list's link answers 404 to everybody, the author too.
  const held = isPublic && board.heldForReview === true;
  // A ranking is out on the page of the list it ranks.
  const published = ownPublish ? publishedPath(board) : null;
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

  // Out or down, the row's buttons change (Publish gives way to Update, View
  // and Take it down, and back): the focus that was on one goes to the row's first.
  const publicationRow = useRef<HTMLLIElement>(null);
  const wasPublic = useRef(isPublic);
  useEffect(() => {
    if (wasPublic.current === isPublic) return;
    wasPublic.current = isPublic;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== box.current) return;
    publicationRow.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [isPublic]);

  // The question at the end of the sheet takes the eye and the cursor.
  const ask = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!asking) return;
    ask.current?.scrollIntoView?.({ block: "nearest" });
    ask.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);

  // Publish, or Show in Rankings. A guest's press signs them in, and the
  // publish goes on once they are (`signInToPublish`). Where Google cannot
  // sign anybody in, as in an app's own browser, it says so.
  const onPublish = () => {
    if (isPublic) setAsking(true);
    else if (!signedIn) {
      setSignInNote(null);
      void (signInToPublish ?? signIn)().then((outcome) => {
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
      : problems.includes("tooManyTiers")
        ? strings.new.tooManyTiers
        : problems.length > 0
          ? strings.new.failedTooLarge
          : null;
  // Why the switch cannot be turned on. Blocked, it stays a Tab stop that
  // says so (aria-disabled), as a disabled input would be skipped unheard.
  const blocker = !signedIn ? strings.boards.needsAccount : problem;
  const blocked = !isPublic && signedIn && blocker !== null;

  // Publish or Update from the ⋮ menu, once the sheet is up: a reason it
  // cannot is said in the Publication row, which the sheet then shows.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || start === undefined || !ownPublish) return;
    const timer = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      if (start === "publish" && !isPublic && !blocked) onPublish();
      else if (start === "update" && isPublic && problems.length === 0) void send("updated");
      else if (start === "publication" || start === "publish" || start === "update") {
        const row = publicationRow.current;
        row?.scrollIntoView?.({ block: "nearest" });
        row?.querySelector<HTMLElement>("button, a")?.focus();
      }
    });
    return () => clearTimeout(timer);
  });
  const why = !isPublic && blocker !== null ? `${id}-public-why` : undefined;
  const failed = (on: PublishFailure["on"]) =>
    failure !== null && failure.on === on ? (
      <span className="sheet-row__problem" role="alert">
        <Icon name="error" />
        {on === "takeDown"
          ? strings.list.deleteFailed
          : on === "update" && failure.error.kind === "notFound"
            ? strings.new.listGone
            : failure.ranking !== undefined
              ? rankingFailureText(failure.error, failure.ranking)
              : failure.error.kind === "invalid" && failure.error.code === "TOPIC_UNAVAILABLE"
                ? strings.boards.topicUnavailable
                : failureText(
                    failure.error,
                    on === "update" ? "edit" : "new",
                    (url) => liveItems(board).find((item) => item.imageUrl === url)?.title ?? null,
                  )}
      </span>
    ) : null;

  const pictures = new Map<string, string>();
  for (const card of liveItems(board)) {
    if (card.imageUrl !== null && !pictures.has(card.imageUrl))
      pictures.set(card.imageUrl, card.title);
  }
  const chosen = board.coverImageUrls;
  const focus = coverFocusOf(board);
  // Adjust cover, over the sheet: opened by Adjust position, and by itself once a picture of one's own is the cover.
  const [adjusting, setAdjusting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const owner = signedIn ? account.uid : null;
  const [transfer, setTransfer] = useState<{
    owner: string;
    board: string;
    error: string | null;
    busy: boolean;
  } | null>(null);
  const active = transfer?.owner === owner && transfer?.board === board.uid ? transfer : null;
  const uploading = active?.busy === true;
  const uploadError = active?.error;
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    return () => pending.current?.abort();
  }, [owner, board.uid]);
  const chooseFile = async (file: File) => {
    if (owner === null) return;
    pending.current?.abort();
    const task = new AbortController();
    pending.current = task;
    const currentTransfer = { owner, board: board.uid };
    setTransfer({ ...currentTransfer, busy: true, error: null });
    try {
      const picture = await upload(file);
      if (task.signal.aborted) return;
      const current = latest();
      if (current.deletedAt !== null) {
        setTransfer(null);
        return;
      }
      keep({
        ...setCover(current, [picture.previewUrl], now()),
        coverPictureId: picture.pictureId,
      });
      setTransfer(null);
      setAdjusting(true);
    } catch (reason) {
      if (!task.signal.aborted)
        setTransfer({
          ...currentTransfer,
          busy: false,
          error: pictureFailureText(file.name, reason),
        });
    }
  };
  const toggleCover = (url: string) => {
    const fromCards = chosen.filter((one) => pictures.has(one));
    const next = fromCards.includes(url)
      ? fromCards.filter((one) => one !== url)
      : [...fromCards, url];
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
            <li ref={publicationRow} className="sheet-row">
              {/* One row for all of it (Danylo, 16.11.2026): Publish or Show in
                  Rankings before it is out; then its status, with Update, View
                  and Take it down under it. Update is filled while the copy
                  out is behind the board. */}
              <Row
                icon={<Icon name={ranks ? "leaderboard" : "public"} />}
                title={strings.boards.publication}
                sub={
                  held
                    ? strings.boards.heldBody
                    : ranks
                      ? isPublic
                        ? strings.boards.rankedBody
                        : strings.rankings.previewRanking
                      : strings.boards.publicBody
                }
                end={
                  isPublic ? (
                    <span className="sheet-row__status">
                      <Icon name="check_circle" />
                      {ranks ? strings.boards.inRankingsStatus : strings.boards.publishedStatus}
                    </span>
                  ) : (
                    <Button
                      variant="tonal"
                      icon={ranks ? "leaderboard" : "publish"}
                      disabled={busy !== "idle"}
                      aria-disabled={blocked || undefined}
                      aria-describedby={why}
                      onClick={() => {
                        if (!blocked) onPublish();
                      }}
                    >
                      {busy === "publishing"
                        ? strings.boards.publishing
                        : ranks
                          ? strings.rankings.progressShare
                          : strings.new.publish}
                    </Button>
                  )
                }
              >
                {why !== undefined && (
                  <span id={why} className="sheet-row__note">
                    {blocker}
                  </span>
                )}
                {isPublic && behind && (
                  <span className="sheet-row__note sheet-row__note--behind">
                    {strings.boards.behind}
                  </span>
                )}
                {isPublic && problem !== null && <span className="sheet-row__note">{problem}</span>}
                {isPublic && (
                  <span className="sheet-row__actions">
                    <Button
                      variant={behind ? "filled" : "tonal"}
                      icon="cloud_upload"
                      onClick={() => void send("updated")}
                      disabled={busy !== "idle" || problems.length > 0}
                    >
                      {busy === "updating" ? strings.boards.updating : strings.boards.update}
                    </Button>
                    {published !== null && (
                      <Link className="sheet-row__link" to={published} state={AS_COMMUNITY}>
                        <Icon name="open_in_new" />
                        <span>{strings.boards.seePublished}</span>
                      </Link>
                    )}
                    <button
                      type="button"
                      className="sheet-row__link sheet-row__link--button"
                      disabled={busy !== "idle"}
                      onClick={() => setAsking(true)}
                    >
                      {strings.boards.takeDown}
                    </button>
                  </span>
                )}
                {signInNote !== null && !signedIn && (
                  <span className="sheet-row__problem" role="alert">
                    <Icon name="error" />
                    {signInNote}
                  </span>
                )}
                {rankInstead !== null && (
                  <div
                    className="sheet-row__question"
                    role="group"
                    aria-label={strings.rankings.publicationPreview}
                  >
                    <p>{strings.rankings.notYours}</p>
                    <button
                      type="button"
                      className="btn btn--tonal"
                      onClick={() => void rankCopy(rankInstead)}
                    >
                      {strings.rankings.progressShare}
                    </button>
                    <button
                      type="button"
                      className="btn btn--text"
                      onClick={() => setRankInstead(null)}
                    >
                      {strings.rankings.cancel}
                    </button>
                  </div>
                )}
                {failed("publish")}
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
                  <FocusedPicture
                    className="sheet-row__thumb"
                    src={thumbnail}
                    focus={chosen.length === 1 ? focus : null}
                    loading="lazy"
                  />
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
                {chosen.length === 1 && chosen[0] && (
                  <>
                    <span className="board-settings__cover-frame">
                      <FocusedPicture src={chosen[0]} focus={focus} />
                    </span>
                    <Button icon="zoom_in" disabled={uploading} onClick={() => setAdjusting(true)}>
                      {strings.cover.adjustPosition}
                    </Button>
                    {adjusting && (
                      <CoverAdjust
                        src={chosen[0]}
                        focus={focus}
                        onCancel={() => setAdjusting(false)}
                        onDone={(placed) => {
                          keep(setCoverFocus(latest(), placed, now()));
                          setAdjusting(false);
                        }}
                      />
                    )}
                  </>
                )}
                {house && chosen.length === 1 && (
                  <CoverCreditPanel
                    key={chosen[0]}
                    credit={coverCreditOf(board) ?? null}
                    onCredit={(given) => keep(setCoverCredit(latest(), given, now()))}
                  />
                )}
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="image/*"
                  aria-label={strings.settings.faceGallery}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void chooseFile(file);
                  }}
                />
                <Button
                  icon="add_photo_alternate"
                  disabled={uploading}
                  onClick={() => (signedIn ? fileInput.current?.click() : void signIn())}
                >
                  {uploading ? plural(strings.new.uploading, 1) : strings.settings.faceGallery}
                </Button>
                {uploadError && <p role="alert">{uploadError}</p>}
                {chosen.length > 0 && (
                  <Button
                    icon="undo"
                    disabled={uploading}
                    onClick={() => keep(setCover(latest(), [], now()))}
                  >
                    {strings.boards.coverReset}
                  </Button>
                )}
                {pictures.size === 0 ? (
                  <p className="sheet-pick__note">{strings.boards.coverNoCards}</p>
                ) : (
                  <>
                    <p className="sheet-pick__note">
                      {fill(strings.boards.coverCards, { n: pictures.size })}
                    </p>
                    <ul className="board-settings__covers" aria-label={strings.boards.cover}>
                      {Array.from(pictures, ([url, name]) => {
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
                                name,
                              })}
                              disabled={uploading || (!on && chosen.length >= MAX_COVER)}
                              onClick={() => toggleCover(url)}
                            >
                              <MediaImage src={url} alt="" loading="lazy" />
                              {on && <span className="board-settings__cover-n">{place + 1}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
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

          {/* Take it down, from beside the row's status or the ⋮ menu: it asks
              first, since the link others have stops working. */}
          {isPublic && asking && (
            <li>
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
                    onClick={() =>
                      void takeDown().then((gone) => {
                        if (gone) setAsking(false);
                      })
                    }
                    disabled={busy !== "idle"}
                  >
                    {strings.boards.takeDown}
                  </Button>
                </div>
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
