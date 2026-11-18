import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession } from "../../app/session";
import { loadAllTopics } from "../../lib/api";
import { uploadPicture } from "../../lib/pictures";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import type { Upload } from "../editor/AddCardBox";
import { sectionName, type Section } from "../sections/model";
import { CoverPicker } from "./CoverPicker";
import { setTopic, type Board } from "./model";
import {
  SectionChips,
  TopicChips,
  topicHeading,
  useSectionTopics,
  type LoadTopics,
} from "./PublishPickers";
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
  /**
   * A board that goes out some other way than the Publish window (a house
   * list): its section and topic are chosen here instead.
   */
  chooseFiling: boolean;
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
 * of publishing. Nothing of publishing stays here (artboard 41, 18.11.2026):
 * the header's Publish opens its own window. A house board, which goes out
 * from the House bar, chooses its section and topic here.
 * Each change is kept the moment it is made.
 */
export function BoardSettings({
  board,
  latest,
  keep,
  sections,
  chooseFiling,
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
  const topics = useSectionTopics(category, load, chooseFiling && category !== null);

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

        {chooseFiling && (
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
