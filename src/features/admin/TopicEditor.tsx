import { useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { TopicChanges, TopicDraft } from "../../api/admin";
import { errorOf, type ApiError } from "../../api/errors";
import { creditAsAttribution, type EditorCredit } from "../../api/pictureAttribution";
import { topicCreditOf, type Topic } from "../../api/sections";
import { fieldsOf } from "../../lib/editorCredit";
import { cropOf } from "../../lib/framing";
import { directionOf, LOCALE_NAMES } from "../../lib/locale";
import { SECTION_PICTURE_MIN } from "../../lib/pictures";
import { useWidthClass } from "../../lib/useWidthClass";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { PictureRows } from "../tierboard/AboutPicture";
import { CreditForm } from "../tierboard/CreditForm";
import { creditWhyText } from "./houseWords";
import { changedNames, newNames, sameCredit, topicNamesOf, TOPIC_LOCALES } from "./topicWords";
import { editorDeps, type EditorDeps } from "../sections/editorDeps";
import { topicPicture, type Section } from "../sections/model";
import { TOPIC_NAME } from "../boards/model";
import { PictureField, type PictureValue } from "../sections/PictureField";
import {
  SECTION_ASPECT,
  shortOf,
  tidySectionName,
  troubleOf,
  type Trouble,
} from "../sections/proposal";
import "../sections/proposal.css";

/**
 * The backend's longest topic name, forty, the same the app's topic dialogs
 * and the site's own publish form allow: staff are not held to fewer.
 */
export const TOPIC_NAME_MAX = TOPIC_NAME.max;

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
      names: mode === "edit" ? topicNamesOf(props.topic.names) : {},
      credit: mode === "edit" ? topicCreditOf(props.topic) : null,
      picture: own === null ? null : ({ kind: "kept", url: own } as PictureValue),
    };
  });
  const [name, setName] = useState(start.name);
  const [names, setNames] = useState(start.names);
  // The translations the backend refused, by language; empty when it did not say which.
  const [namesTrouble, setNamesTrouble] = useState<readonly string[] | null>(null);
  const [nameRefused, setNameRefused] = useState<string | null>(null);
  const [picture, setPicture] = useState<PictureValue | null>(start.picture);
  // The credit the editor gave or took off; null while they have not touched it.
  const [given, setGiven] = useState<{ credit: EditorCredit | null } | null>(null);
  const [creditForm, setCreditForm] = useState(false);
  const [creditTrouble, setCreditTrouble] = useState<string | null>(null);
  const [pictureTrouble, setPictureTrouble] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);

  const tidy = tidySectionName(name);
  const newPicture = picture?.kind === "framed";
  const removed = start.picture !== null && picture === null;
  const pictureReady = picture === null || picture.kind === "kept" || picture.size !== null;
  const renamed = tidy !== tidySectionName(start.name);
  const translated = changedNames(start.names, names);
  // A new picture comes without the old one's credit (the backend drops it) until one is given.
  const credit = given !== null ? given.credit : newPicture ? null : start.credit;
  const creditChanged =
    picture !== null &&
    (newPicture ? credit !== null : given !== null && !sameCredit(credit, start.credit));
  const changed = renamed || newPicture || removed || translated !== null || creditChanged;
  const ready = tidy !== "" && pictureReady && (mode === "create" || changed);
  const nameTaken = taken !== null && taken === tidy;
  const nameTrouble = nameTaken || (nameRefused !== null && nameRefused === tidy);
  // What closing would throw away: what was typed or chosen for a new topic, any change to one.
  const edited =
    mode === "create" ? tidy !== "" || picture !== null || newNames(names) !== null : changed;

  // Typed work is not thrown away unasked, as the section editor does it.
  const close = () => {
    if (sending) return;
    if (asking) setAsking(false);
    else if (edited) setAsking(true);
    else onClose();
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
      const all = newNames(names);
      return props.send({
        name: tidy,
        section: section.id,
        ...(all === null ? {} : { names: all }),
        ...(pictureId === null ? {} : { pictureId }),
        ...(pictureId !== null && credit !== null ? { pictureAttribution: credit } : {}),
      });
    }
    // The credit goes with a new picture, or alone when it was changed on the picture the topic keeps.
    const withCredit =
      picture === null || (newPicture ? credit === null : !creditChanged)
        ? {}
        : { pictureAttribution: credit };
    return props.send({
      ...(renamed ? { name: tidy } : {}),
      ...(translated === null ? {} : { names: translated }),
      ...(pictureId !== null ? { pictureId } : removed ? { pictureId: null } : {}),
      ...withCredit,
    });
  };

  // What the backend refused in the translations or the credit, said at its field.
  const refusedWords = (error: ApiError): boolean => {
    if (error.kind !== "invalid") return false;
    if (error.code === "BAD_ATTRIBUTION") {
      setCreditTrouble(fill(strings.credit.refusedPicture, { why: creditWhyText(error.why) }));
      return true;
    }
    if (error.code !== "INVALID") return false;
    // The languages this save sent a translation in: an empty one only takes a translation away.
    const sent = Object.entries(mode === "create" ? (newNames(names) ?? {}) : (translated ?? {}))
      .filter(([, text]) => text !== "")
      .map(([locale]) => locale);
    // The backend names the field and the first language refused (Proxy #134); a refusal
    // without them is told from what was sent.
    const field =
      error.field ??
      (sent.length > 0 && !renamed ? "names" : renamed && sent.length === 0 ? "name" : null);
    if (field === "names") {
      setNamesTrouble(error.locale !== undefined ? [error.locale] : sent);
      return true;
    }
    if (field === "name") {
      setNameRefused(tidy);
      return true;
    }
    return false;
  };

  const submit = async () => {
    if (!ready || sending) return;
    setSending(true);
    setFailed(false);
    setNamesTrouble(null);
    setNameRefused(null);
    setCreditTrouble(null);
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
      const error = errorOf(reason);
      if (refusedWords(error)) return;
      const trouble = troubleOf(error);
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
        {/* Divs, not header and footer: in a dialog those would be a second banner and contentinfo. */}
        {compact ? (
          <div className="section-editor__bar">
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
          </div>
        ) : (
          <div className="section-editor__head">
            <h2 id={`${id}-title`} className="dialog__title">
              {title}
            </h2>
          </div>
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
          {picture !== null && (
            <section
              className="section-editor__field topic-editor__credit"
              aria-label={strings.link.about}
            >
              <p className="section-editor__label">{strings.link.about}</p>
              {creditForm ? (
                <CreditForm
                  catalogue
                  inForm
                  note={strings.credit.topicNote}
                  initial={fieldsOf(credit === null ? null : creditAsAttribution(credit))}
                  editing={{
                    save: (next) => {
                      setGiven({ credit: next });
                      setCreditTrouble(null);
                    },
                    remove:
                      credit === null
                        ? undefined
                        : () => {
                            setGiven({ credit: null });
                            setCreditTrouble(null);
                          },
                  }}
                  onDone={() => setCreditForm(false)}
                />
              ) : (
                <>
                  <PictureRows attribution={credit === null ? null : creditAsAttribution(credit)} />
                  <Button icon="edit" onClick={() => setCreditForm(true)}>
                    {credit === null ? strings.credit.add : strings.credit.edit}
                  </Button>
                </>
              )}
              {creditTrouble !== null && (
                <p className="section-editor__error" role="alert">
                  {creditTrouble}
                </p>
              )}
            </section>
          )}
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
                  {/* A topic's name is taken in every section, not only this one. */}
                  {nameTaken
                    ? fill(strings.admin.topicExists, { name: tidy })
                    : fill(strings.admin.topicNameRefused, { max: TOPIC_NAME_MAX })}
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
          <fieldset className="section-editor__field translations">
            <legend className="section-editor__label">{strings.admin.translations}</legend>
            <p className="section-editor__help">{strings.admin.translationsHelp}</p>
            <div className="translations__grid">
              {TOPIC_LOCALES.map((locale) => (
                <label key={locale} className="translations__field">
                  <span className="translations__language">{LOCALE_NAMES[locale]}</span>
                  <input
                    lang={locale}
                    dir={directionOf(locale)}
                    maxLength={TOPIC_NAME_MAX}
                    value={names[locale] ?? ""}
                    placeholder={tidy}
                    aria-invalid={
                      namesTrouble !== null &&
                      (namesTrouble.length === 0 || namesTrouble.includes(locale))
                    }
                    onChange={(event) => {
                      setNames({ ...names, [locale]: event.target.value });
                      setNamesTrouble(null);
                    }}
                  />
                </label>
              ))}
            </div>
            {namesTrouble !== null && (
              <p className="section-editor__error" role="alert">
                {namesTrouble.length === 0
                  ? fill(strings.admin.topicNamesRefused, { max: TOPIC_NAME_MAX })
                  : fill(strings.admin.topicNamesRefusedIn, {
                      languages: namesTrouble
                        .map((locale) => LOCALE_NAMES[locale as keyof typeof LOCALE_NAMES])
                        .join(", "),
                      max: TOPIC_NAME_MAX,
                    })}
              </p>
            )}
          </fieldset>
        </div>
        {(!compact || failed || asking) && (
          <div className="section-editor__foot">
            {failed && (
              <div className="section-editor__failed" role="alert">
                <p>{strings.admin.saveFailed}</p>
                <Button onClick={() => void submit()}>{strings.sections.tryAgain}</Button>
              </div>
            )}
            {asking ? (
              // Keyed apart from the row it replaces, as in the section editor.
              <div key="ask" className="section-editor__actions section-editor__ask">
                <p className="section-editor__ask-text">{strings.admin.discardChanges}</p>
                <Button onClick={() => setAsking(false)}>{strings.propose.keepEditing}</Button>
                <Button variant="danger" onClick={onClose}>
                  {strings.propose.discard}
                </Button>
              </div>
            ) : compact ? null : (
              <div key="actions" className="section-editor__actions">
                <Button onClick={close} disabled={sending}>
                  {strings.admin.cancel}
                </Button>
                {sendButton}
              </div>
            )}
          </div>
        )}
      </form>
    </div>,
    document.body,
  );
}
