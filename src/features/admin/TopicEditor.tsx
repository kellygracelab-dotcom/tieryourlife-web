import { useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { TopicChanges, TopicDraft } from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { Topic } from "../../api/sections";
import { cropOf } from "../../lib/framing";
import { SECTION_PICTURE_MIN } from "../../lib/pictures";
import { useWidthClass } from "../../lib/useWidthClass";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { editorDeps, type EditorDeps } from "../sections/editorDeps";
import { topicPicture, type Section } from "../sections/model";
import { PictureField, type PictureValue } from "../sections/PictureField";
import {
  SECTION_ASPECT,
  shortOf,
  tidySectionName,
  troubleOf,
  type Trouble,
} from "../sections/proposal";
import "../sections/proposal.css";

/** The backend's longest topic name the form lets anybody type. */
export const TOPIC_NAME_MAX = 24;

interface Common {
  /** The section the topic is in: its icon labels the picture, its name a clash. */
  section: Section;
  deps?: EditorDeps;
  onDone: (topic: Topic) => void;
  onClose: () => void;
}

export type TopicEditorProps = Common &
  (
    | { mode: "create"; send: (draft: TopicDraft) => Promise<Topic> }
    | { mode: "edit"; topic: Topic; send: (changes: TopicChanges) => Promise<Topic> }
  );

/**
 * New topic and Edit topic (docs/design-spec-walk-3.md, E1): a dialog 560
 * wide with the same drop zone and 16:10 crop as Propose a section, the
 * label previewed bottom-left, and Remove picture under it, after which the
 * topic wears its section's colours again. The whole screen below 600.
 */
export function TopicEditor(props: TopicEditorProps) {
  const { mode, section, onDone, onClose, deps = editorDeps } = props;
  const id = useId();
  const box = useRef<HTMLFormElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const compact = useWidthClass() === "compact";
  const [start] = useState(() => {
    const own = mode === "edit" ? topicPicture(props.topic) : null;
    return {
      name: mode === "edit" ? props.topic.name : "",
      picture: own === null ? null : ({ kind: "kept", url: own } as PictureValue),
    };
  });
  const [name, setName] = useState(start.name);
  const [picture, setPicture] = useState<PictureValue | null>(start.picture);
  const [pictureTrouble, setPictureTrouble] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const tidy = tidySectionName(name);
  const newPicture = picture?.kind === "framed";
  const removed = start.picture !== null && picture === null;
  const pictureReady = picture === null || picture.kind === "kept" || picture.size !== null;
  const renamed = tidy !== tidySectionName(start.name);
  const ready =
    tidy !== "" && pictureReady && (mode === "create" || renamed || newPicture || removed);
  const nameTrouble = taken !== null && taken === tidy;

  const close = () => {
    if (!sending) onClose();
  };
  useModal(box, close);

  const refusePicture = (trouble: Trouble) => {
    if (trouble.kind === "notCropped") {
      setPictureTrouble(strings.propose.notCropped);
      return;
    }
    const size = picture?.kind === "framed" ? picture.size : null;
    const width = size === null ? 0 : (shortOf(size) ?? size.width);
    setPicture(start.picture);
    setPictureTrouble(
      trouble.kind === "tooSmall"
        ? fill(strings.propose.tooSmall, { width, min: SECTION_PICTURE_MIN.width })
        : strings.propose.notImage,
    );
  };

  const sendNow = (pictureId: string | null): Promise<Topic> => {
    if (props.mode === "create") {
      return props.send({
        name: tidy,
        section: section.id,
        ...(pictureId === null ? {} : { pictureId }),
      });
    }
    return props.send({
      ...(renamed ? { name: tidy } : {}),
      ...(pictureId !== null ? { pictureId } : removed ? { pictureId: null } : {}),
    });
  };

  const submit = async () => {
    if (!ready || sending) return;
    setSending(true);
    setFailed(false);
    try {
      let pictureId: string | null = null;
      if (picture?.kind === "framed" && picture.size !== null) {
        let bytes: Blob;
        try {
          const drawn = image.current;
          if (drawn === null) throw new Error("no picture");
          bytes = await deps.crop(
            drawn,
            cropOf(picture.framing, { picture: picture.size, aspect: SECTION_ASPECT }),
          );
        } catch {
          setSending(false);
          refusePicture({ kind: "notImage" });
          return;
        }
        pictureId = (await deps.upload(bytes)).pictureId;
      }
      onDone(await sendNow(pictureId));
    } catch (reason: unknown) {
      setSending(false);
      const trouble = troubleOf(errorOf(reason));
      switch (trouble.kind) {
        case "nameTaken":
          setTaken(tidy);
          return;
        case "tooSmall":
        case "notImage":
        case "notCropped":
          refusePicture(trouble);
          return;
        default:
          setFailed(true);
      }
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const title = mode === "create" ? strings.admin.newTopic : strings.admin.editTopic;
  const action = mode === "create" ? strings.admin.create : strings.admin.save;

  const sendButton = (
    <Button
      variant={compact ? "text" : "filled"}
      type="submit"
      disabled={!ready || sending}
      className="section-editor__send"
    >
      {sending && <span className="spinner" aria-hidden="true" />}
      {action}
    </Button>
  );

  return createPortal(
    <div className="scrim section-editor__scrim section-editor__scrim--dialog" onClick={close}>
      <form
        ref={box}
        className={`section-editor section-editor--${compact ? "full" : "dialog"} topic-editor`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={sending}
        noValidate
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        {compact ? (
          <header className="section-editor__bar">
            <button
              type="button"
              className="section-editor__close"
              aria-label={strings.propose.close}
              disabled={sending}
              onClick={close}
            >
              <Icon name="close" />
            </button>
            <h2 id={`${id}-title`} className="section-editor__bar-title">
              {title}
            </h2>
            {sendButton}
          </header>
        ) : (
          <header className="section-editor__head">
            <h2 id={`${id}-title`} className="dialog__title">
              {title}
            </h2>
          </header>
        )}
        <div className="section-editor__body" inert={sending}>
          <div className="section-editor__field">
            <p className="section-editor__label">{strings.admin.picture}</p>
            <PictureField
              value={picture}
              onChange={setPicture}
              trouble={pictureTrouble}
              onTrouble={setPictureTrouble}
              name={tidy}
              icon={section.icon}
              image={image}
              editing={mode === "edit"}
              thumbs={false}
            />
            {picture !== null && (
              <Button
                className="topic-editor__remove"
                onClick={() => {
                  setPicture(null);
                  setPictureTrouble(null);
                }}
              >
                {strings.admin.removePicture}
              </Button>
            )}
          </div>
          <div className="section-editor__field">
            <div className={nameTrouble ? "outlined outlined--error" : "outlined"}>
              <label className="outlined__label" htmlFor={`${id}-name`}>
                {strings.admin.topicName}
              </label>
              <input
                id={`${id}-name`}
                className="outlined__input"
                type="text"
                value={name}
                maxLength={TOPIC_NAME_MAX}
                autoComplete="off"
                aria-invalid={nameTrouble}
                aria-describedby={nameTrouble ? `${id}-name-trouble` : undefined}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setName(tidySectionName(name))}
              />
            </div>
            <div className="section-editor__under">
              {nameTrouble && (
                <p id={`${id}-name-trouble`} className="section-editor__error" role="alert">
                  {fill(strings.admin.topicTaken, { name: tidy, section: section.name })}
                </p>
              )}
              <span
                className={
                  name.length >= TOPIC_NAME_MAX
                    ? "section-editor__counter section-editor__counter--full"
                    : "section-editor__counter"
                }
                aria-hidden="true"
              >
                {fill(strings.settings.nameCounter, { n: name.length, max: TOPIC_NAME_MAX })}
              </span>
            </div>
          </div>
        </div>
        {(!compact || failed) && (
          <footer className="section-editor__foot">
            {failed && (
              <div className="section-editor__failed" role="alert">
                <p>{strings.admin.saveFailed}</p>
                <Button onClick={() => void submit()}>{strings.sections.tryAgain}</Button>
              </div>
            )}
            {!compact && (
              <div className="section-editor__actions">
                <Button onClick={close} disabled={sending}>
                  {strings.admin.cancel}
                </Button>
                {sendButton}
              </div>
            )}
          </footer>
        )}
      </form>
    </div>,
    document.body,
  );
}
