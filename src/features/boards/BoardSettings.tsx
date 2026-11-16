import { MediaImage } from "../../ui/MediaImage";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { creditAsAttribution, type EditorCredit } from "../../api/pictureAttribution";
import { useSession } from "../../app/session";
import { loadAllTopics } from "../../lib/api";
import { fieldsOf } from "../../lib/editorCredit";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { CoverAdjust } from "../../ui/CoverAdjust";
import { FocusedPicture } from "../../ui/FocusedPicture";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { pictureFailureText, type Upload } from "../editor/AddCardBox";
import { uploadPicture } from "../../lib/pictures";
import { sectionName, type Section } from "../sections/model";
import { PictureRows } from "../tierboard/AboutPicture";
import { CreditForm } from "../tierboard/CreditForm";
import {
  coverCreditOf,
  coverFocusOf,
  isOut,
  liveItems,
  setCover,
  setCoverCredit,
  setCoverFocus,
  setTopic,
  type Board,
} from "./model";
import {
  SectionChips,
  TopicChips,
  topicHeading,
  useSectionTopics,
  type LoadTopics,
} from "./PublishPickers";
import { filedUnder } from "./sectionChoices";
import "./boards.css";
import "./publishing.css";

export type { LoadTopics } from "./PublishPickers";
export type {
  PublishBoard,
  PublishingDeps,
  RepublishBoard,
  UnpublishBoard,
} from "./usePublication";

interface BoardSettingsProps {
  board: Board;
  /** The board as it is right now, for a change made after a wait on the network. */
  latest: () => Board;
  keep: (board: Board) => void;
  /** The sections as the site holds them, the person's own waiting ones among them. */
  sections: readonly Section[];
  /** Where the person's own proposals no longer waiting keep their lists, by id. */
  proposalHomes?: Readonly<Record<string, string>>;
  /**
   * Publication's button: the page opens the Publish window. Null for a
   * board that goes out some other way (a house list), whose section and
   * topic are then chosen here instead.
   */
  onPublication: (() => void) | null;
  onCategory: (category: string) => void;
  /** A house board: its cover of one picture takes the editor's own credit here. */
  house?: boolean;
  upload?: Upload;
  topics?: LoadTopics;
  onDone: () => void;
  now?: () => number;
}

const MAX_COVER = 6;

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

/**
 * The board's cover, in a window in the middle (Danylo's canvas,
 * 16.11.2026): what is left of the list settings once the header took the
 * display and the Publish window took the section, the topic and the rest
 * of publishing. Under the cover, one Publication line: where the list
 * stands, and the button that opens the Publish window. A house board,
 * which goes out from the House bar, chooses its section and topic here.
 * Each change is kept the moment it is made.
 */
export function BoardSettings({
  board,
  latest,
  keep,
  sections,
  proposalHomes = {},
  onPublication,
  onCategory,
  house = false,
  upload = uploadPicture,
  topics: load = loadAllTopics,
  onDone,
  now = Date.now,
}: BoardSettingsProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onDone);
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const uid = signedIn ? account.uid : null;

  const pictures = new Map<string, string>();
  for (const card of liveItems(board)) {
    if (card.imageUrl !== null && !pictures.has(card.imageUrl))
      pictures.set(card.imageUrl, card.title);
  }
  const chosen = board.coverImageUrls;
  const focus = coverFocusOf(board);
  // Adjust cover, over the window: opened by Adjust position, and by itself once a picture of one's own is the cover.
  const [adjusting, setAdjusting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const owner = uid;
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

  // A house board's section and topic, chosen here as it has no Publish window.
  const category = board.category;
  const topics = useSectionTopics(category, load, onPublication === null && category !== null);
  const where = category === null ? null : filedUnder(category, sections, uid, proposalHomes);

  // Where the list stands, in one line: out or not, and under what.
  const ranks =
    board.rankingOf !== null || (board.takenFrom !== null && board.publishedId === null);
  const out = isOut(board);
  const held = out && board.heldForReview === true;
  const standing = out
    ? [
        held
          ? strings.boards.heldBody
          : ranks
            ? strings.boards.inRankingsStatus
            : strings.boards.publishedStatus,
        ...(ranks || where === null ? [] : [where]),
        ...(ranks || board.topic === null ? [] : [board.topic.name]),
      ].join(" · ")
    : ranks
      ? strings.rankings.previewRanking
      : strings.boards.publicBody;

  return createPortal(
    <div className="scrim" onClick={onDone}>
      <div
        ref={box}
        className="dialog board-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="board-settings__head">
          <h2 id={`${id}-title`} className="dialog__title">
            {strings.boards.cover}
          </h2>
          <Button onClick={onDone}>{strings.boards.done}</Button>
        </div>

        <div className="sheet-pick sheet-pick--cover board-settings__cover-pick">
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
          <span className="board-settings__cover-tools">
            <Button
              icon="add_photo_alternate"
              disabled={uploading}
              onClick={() => (signedIn ? fileInput.current?.click() : void signIn())}
            >
              {uploading ? plural(strings.new.uploading, 1) : strings.settings.faceGallery}
            </Button>
            {chosen.length > 0 && (
              <Button
                icon="undo"
                disabled={uploading}
                onClick={() => keep(setCover(latest(), [], now()))}
              >
                {strings.boards.coverReset}
              </Button>
            )}
          </span>
          {uploadError && <p role="alert">{uploadError}</p>}
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
                        aria-label={fill(strings.boards.coverPick, { name })}
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

        {onPublication !== null ? (
          <div className="board-settings__publication">
            <Icon
              name={ranks ? "leaderboard" : "public"}
              className="board-settings__publication-icon"
            />
            <span className="board-settings__publication-text">
              <span className="board-settings__publication-title">
                {strings.boards.publication}
              </span>
              <span className="board-settings__publication-sub">{standing}</span>
            </span>
            {out ? (
              <Button variant="outlined" onClick={onPublication}>
                {strings.publishWindow.open}
              </Button>
            ) : (
              <Button
                variant="tonal"
                icon={ranks ? "leaderboard" : "publish"}
                onClick={onPublication}
              >
                {ranks ? strings.rankings.progressShare : strings.new.publish}
              </Button>
            )}
          </div>
        ) : (
          <div className="board-settings__filing">
            <section aria-labelledby={`${id}-section`}>
              <h3 id={`${id}-section`} className="publish-window__label">
                {strings.publishWindow.section}
              </h3>
              <SectionChips
                sections={sections}
                uid={uid}
                chosen={category}
                onChoose={(section) => {
                  if (section !== latest().category) onCategory(section);
                }}
                label={strings.publishWindow.section}
              />
            </section>
            <section aria-labelledby={`${id}-topic`}>
              <h3 id={`${id}-topic`} className="publish-window__label">
                {topicHeading(category === null ? null : sectionName(category, sections))}
              </h3>
              {category === null ? (
                <p className="publish-window__note">{strings.publishWindow.topicFirst}</p>
              ) : (
                <TopicChips
                  topic={board.topic}
                  topics={topics}
                  onPick={(topic) => keep(setTopic(latest(), topic, now()))}
                  label={strings.boards.topic}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
