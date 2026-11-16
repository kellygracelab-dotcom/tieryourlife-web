import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession } from "../../app/session";
import { loadAllTopics } from "../../lib/api";
import { uploadPicture } from "../../lib/pictures";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import type { Upload } from "../editor/AddCardBox";
import { sectionName, type Section } from "../sections/model";
import { CoverPicker } from "./CoverPicker";
import { isOut, setTopic, type Board } from "./model";
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
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;

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

        <CoverPicker
          board={board}
          latest={latest}
          keep={keep}
          house={house}
          upload={upload}
          now={now}
        />

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
