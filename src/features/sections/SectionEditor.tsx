import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { SectionChanges, SectionDraft } from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { SectionProposal, SectionStats } from "../../api/sections";
import { CENTRED, cropOf } from "../../lib/framing";
import { directionOf, LOCALE_NAMES, LOCALES } from "../../lib/locale";
import { dataUrlOf, SECTION_PICTURE_MIN } from "../../lib/pictures";
import type { KeyValueStore } from "../../lib/storage";
import { useWidthClass } from "../../lib/useWidthClass";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { editorDeps, type EditorDeps } from "./editorDeps";
import { IconGrid } from "./IconGrid";
import { OTHER, sectionOf, sectionPath, type Section, type SectionIcon } from "./model";
import { PictureField, type PictureValue } from "./PictureField";
import {
  changesOf,
  fileUnderChoices,
  forgetProposal,
  isSectionName,
  keepProposal,
  NAME_CHECK_MS,
  PENDING_MAX,
  PROPOSALS_PER_DAY,
  readKeptProposal,
  SECTION_ASPECT,
  SECTION_NAME_MAX,
  shortOf,
  tidySectionName,
  translationsOf,
  troubleOf,
  wordsOf,
  type SectionWords,
  type Trouble,
} from "./proposal";
import "./proposal.css";

interface Common {
  onDone: (section: SectionStats) => void;
  onClose: () => void;
  deps?: EditorDeps;
}

/** The three uses of one form: somebody's proposal, the owner's new section, the owner's edit. */
export type SectionEditorProps = Common &
  (
    | {
        mode: "propose";
        send: (proposal: SectionProposal) => Promise<SectionStats>;
        /** Every section the person sees, for "File my lists under". */
        sections: readonly Section[];
        fileUnder?: string;
        /** How many of the person's proposals already wait. */
        waiting?: number;
        onTooMany: () => void;
      }
    | { mode: "create"; send: (draft: SectionDraft) => Promise<SectionStats> }
    | {
        mode: "edit";
        section: SectionStats;
        send: (changes: SectionChanges) => Promise<SectionStats>;
      }
  );

/** What the backend or the live check said of a name, and of which one. */
type Verdict = { name: string } & (
  { kind: "free" } | { kind: "taken"; id: string | null } | { kind: "bad" }
);

interface Start extends SectionWords {
  fileUnder: string;
  picture: PictureValue | null;
}

/** Where the form starts: the section as it is, a proposal kept from a failed try, or nothing. */
function startOf(props: SectionEditorProps, keep: KeyValueStore): Start {
  if (props.mode === "edit") {
    const look = sectionOf(props.section);
    return {
      ...wordsOf(props.section, look),
      fileUnder: OTHER,
      picture: look.picture === null ? null : { kind: "kept", url: look.picture },
    };
  }
  const fileUnder = props.mode === "propose" ? (props.fileUnder ?? OTHER) : OTHER;
  const kept = props.mode === "propose" ? readKeptProposal(keep) : null;
  if (kept === null) return { name: "", names: {}, icon: "category", fileUnder, picture: null };
  return {
    name: kept.name,
    names: {},
    icon: kept.icon,
    fileUnder: kept.fileUnder,
    picture:
      kept.picture === null
        ? null
        : {
            kind: "framed",
            url: kept.picture,
            name: "",
            size: null,
            framing: CENTRED,
            remote: false,
          },
  };
}

/**
 * Propose a section (docs/design-spec-admin.md, 2), and the owner's New
 * section and Edit made of the same parts (3.4, 3.5). A dialog from 600 px,
 * the whole screen below; the edit is a side sheet. The name is asked about
 * as it is typed; a refusal is said where it belongs; a try that fails keeps
 * everything, in this tab even across a reload. Closing with something typed
 * or chosen asks first, in the row of actions.
 */
export function SectionEditor(props: SectionEditorProps) {
  const { mode, onDone, onClose, deps = editorDeps } = props;
  const id = useId();
  const box = useRef<HTMLFormElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const compact = useWidthClass() === "compact";
  const [start] = useState(() => startOf(props, deps.keep));
  const [name, setName] = useState(start.name);
  const [names, setNames] = useState(start.names);
  const [icon, setIcon] = useState<SectionIcon>(start.icon);
  const [fileUnder, setFileUnder] = useState(start.fileUnder);
  const [picture, setPicture] = useState<PictureValue | null>(start.picture);
  const [pictureTrouble, setPictureTrouble] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [sending, setSending] = useState(false);
  // The bar above the actions: a failure worth another try, or a refusal that is not.
  const [bar, setBar] = useState<"failed" | "banned" | "tooManyToday" | null>(null);
  const [asking, setAsking] = useState(false);

  const tidy = tidySectionName(name);
  // An edit's own name, and its own id in a clash, are no clash.
  const ownId = mode === "edit" ? props.section.id : null;
  const ownName = mode === "edit" ? tidySectionName(start.name) : null;
  const words: SectionWords = { name, names, icon };
  const changes = mode === "edit" ? changesOf(start, words) : {};
  const newPicture = picture?.kind === "framed";
  const pictureReady = picture === null || picture.kind === "kept" || picture.size !== null;
  const ready =
    tidy !== "" &&
    pictureReady &&
    (mode === "propose"
      ? newPicture
      : mode === "edit"
        ? Object.keys(changes).length > 0 || newPicture
        : true);
  const edited =
    mode === "edit"
      ? Object.keys(changes).length > 0 || newPicture
      : picture !== null || tidy !== "" || Object.keys(translationsOf(names)).length > 0;

  // Once typing stops, whether the name is free; a section's own name is not asked about.
  useEffect(() => {
    const asked = tidySectionName(name);
    if (!isSectionName(asked) || asked === ownName) return;
    let current = true;
    const timer = setTimeout(() => {
      deps.check(asked).then(
        (answer) => {
          if (!current) return;
          if (answer.free || (ownId !== null && answer.id === ownId)) {
            setVerdict({ name: asked, kind: "free" });
          } else if (answer.code === "BAD_NAME") {
            setVerdict({ name: asked, kind: "bad" });
          } else {
            setVerdict({ name: asked, kind: "taken", id: answer.id ?? null });
          }
        },
        // A check that did not come is no answer: the send will say.
        () => undefined,
      );
    }, NAME_CHECK_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [name, deps, ownId, ownName]);

  const nameTrouble =
    verdict !== null && verdict.name === tidy && verdict.kind !== "free" ? verdict : null;

  const close = () => {
    if (sending) return;
    if (asking) setAsking(false);
    else if (edited) setAsking(true);
    else onClose();
  };
  useModal(box, close);

  const discard = () => {
    if (mode === "propose") forgetProposal(deps.keep);
    onClose();
  };

  /** A proposal that did not go waits in the tab: its words now, its picture once it is text. */
  const keep = (bytes: Blob | null) => {
    if (mode !== "propose") return;
    const kept = { name: tidy, icon, fileUnder };
    keepProposal(deps.keep, { ...kept, picture: null });
    if (bytes === null) return;
    dataUrlOf(bytes).then(
      (url) => keepProposal(deps.keep, { ...kept, picture: url }),
      () => undefined,
    );
  };

  const refusePicture = (trouble: Trouble) => {
    if (trouble.kind === "notCropped") {
      setPictureTrouble(strings.propose.notCropped);
      return;
    }
    // The backend measured the crop; the person knows the picture they chose.
    const size = picture?.kind === "framed" ? picture.size : null;
    const width = size === null ? 0 : (shortOf(size) ?? size.width);
    setPicture(null);
    setPictureTrouble(
      trouble.kind === "tooSmall"
        ? fill(strings.propose.tooSmall, { width, min: SECTION_PICTURE_MIN.width })
        : strings.propose.notImage,
    );
  };

  const fail = (trouble: Trouble, bytes: Blob | null) => {
    switch (trouble.kind) {
      case "nameTaken":
        setVerdict({ name: tidy, kind: "taken", id: trouble.id });
        return;
      case "badName":
        setVerdict({ name: tidy, kind: "bad" });
        return;
      case "tooSmall":
      case "notImage":
      case "notCropped":
        refusePicture(trouble);
        return;
      case "tooMany":
        keep(bytes);
        if (props.mode === "propose") props.onTooMany();
        return;
      case "banned":
      case "tooManyToday":
        setBar(trouble.kind);
        return;
      case "failed":
        keep(bytes);
        setBar("failed");
    }
  };

  const sendNow = (pictureId: string | null): Promise<SectionStats> => {
    switch (props.mode) {
      case "propose":
        return props.send({ name: tidy, icon, pictureId: pictureId ?? "", fileUnder });
      case "create": {
        const translated = translationsOf(names);
        return props.send({
          name: tidy,
          icon,
          ...(Object.keys(translated).length > 0 ? { names: translated } : {}),
          ...(pictureId === null ? {} : { pictureId }),
        });
      }
      case "edit":
        return props.send({ ...changes, ...(pictureId === null ? {} : { pictureId }) });
    }
  };

  const submit = async () => {
    if (!ready || sending) return;
    setSending(true);
    setBar(null);
    setAsking(false);
    let bytes: Blob | null = null;
    try {
      let pictureId: string | null = null;
      if (picture?.kind === "framed" && picture.size !== null) {
        try {
          const drawn = image.current;
          if (drawn === null) throw new Error("no picture");
          const stage = { picture: picture.size, aspect: SECTION_ASPECT };
          bytes = await deps.crop(drawn, cropOf(picture.framing, stage));
        } catch {
          // A picture the page may not draw cannot be anybody's tile.
          setSending(false);
          refusePicture({ kind: "notImage" });
          return;
        }
        pictureId = (await deps.upload(bytes)).pictureId;
      }
      const saved = await sendNow(pictureId);
      if (mode === "propose") forgetProposal(deps.keep);
      onDone(saved);
    } catch (reason: unknown) {
      setSending(false);
      fail(troubleOf(errorOf(reason)), bytes);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const title =
    mode === "propose"
      ? strings.propose.title
      : mode === "create"
        ? strings.admin.newSection
        : strings.admin.editSection;
  const action =
    mode === "propose"
      ? strings.propose.propose
      : mode === "create"
        ? strings.admin.create
        : strings.admin.save;
  const layout = mode === "edit" ? "side" : "dialog";
  const intro = mode === "propose" ? strings.propose.intro : null;
  const builtIn = mode === "edit" && sectionOf(props.section).builtIn;

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

  const pictureField = (
    <PictureField
      value={picture}
      onChange={setPicture}
      trouble={pictureTrouble}
      onTrouble={setPictureTrouble}
      name={tidy}
      icon={icon}
      image={image}
      editing={mode === "edit"}
    />
  );

  const nameField = (
    <div className="section-editor__field">
      <div className={nameTrouble === null ? "outlined" : "outlined outlined--error"}>
        <label className="outlined__label" htmlFor={`${id}-name`}>
          {strings.propose.name}
        </label>
        <input
          id={`${id}-name`}
          className="outlined__input"
          type="text"
          value={name}
          maxLength={SECTION_NAME_MAX}
          placeholder={strings.propose.namePlaceholder}
          autoComplete="off"
          aria-invalid={nameTrouble !== null}
          aria-describedby={nameTrouble === null ? undefined : `${id}-name-trouble`}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setName(tidySectionName(name))}
        />
      </div>
      <div className="section-editor__under">
        {nameTrouble !== null && (
          <p id={`${id}-name-trouble`} className="section-editor__error" role="alert">
            {nameTrouble.kind === "bad"
              ? strings.propose.badName
              : fill(strings.propose.nameTaken, { name: nameTrouble.name })}
            {nameTrouble.kind === "taken" && nameTrouble.id !== null && (
              <>
                {" "}
                <Link to={sectionPath(nameTrouble.id)}>{strings.propose.openIt}</Link>
              </>
            )}
          </p>
        )}
        <span
          className={
            name.length >= SECTION_NAME_MAX
              ? "section-editor__counter section-editor__counter--full"
              : "section-editor__counter"
          }
          aria-hidden="true"
        >
          {fill(strings.settings.nameCounter, { n: name.length, max: SECTION_NAME_MAX })}
        </span>
      </div>
    </div>
  );

  const iconField = (
    <div className="section-editor__field">
      <p id={`${id}-icon`} className="section-editor__label">
        {strings.propose.icon}
      </p>
      <IconGrid value={icon} onChange={setIcon} labelledBy={`${id}-icon`} />
    </div>
  );

  const translationsField = (
    <fieldset className="section-editor__field translations">
      <legend className="section-editor__label">{strings.admin.translations}</legend>
      <p className="section-editor__help">{strings.admin.translationsHelp}</p>
      <div className="translations__grid">
        {LOCALES.map((locale) => (
          <label key={locale} className="translations__field">
            <span className="translations__language">{LOCALE_NAMES[locale]}</span>
            <input
              lang={locale}
              dir={directionOf(locale)}
              maxLength={SECTION_NAME_MAX}
              value={names[locale] ?? ""}
              placeholder={tidy}
              onChange={(event) => setNames({ ...names, [locale]: event.target.value })}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );

  let fields: ReactNode;
  if (props.mode === "propose") {
    const choices = fileUnderChoices(props.sections);
    const filed = choices.some((one) => one.id === fileUnder) ? fileUnder : OTHER;
    const waiting = props.waiting ?? 0;
    fields = (
      <>
        {pictureField}
        {nameField}
        {iconField}
        <div className="section-editor__field">
          <label className="outlined outlined--select">
            <span className="outlined__label">{strings.propose.fileUnder}</span>
            <select
              className="outlined__input"
              value={filed}
              aria-describedby={`${id}-file-help`}
              onChange={(event) => setFileUnder(event.target.value)}
            >
              {choices.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
            <Icon name="expand_more" className="outlined__chevron" />
          </label>
          <p id={`${id}-file-help`} className="section-editor__help">
            {strings.propose.fileUnderHelp}
          </p>
        </div>
        {waiting > 0 && (
          <p className="section-editor__waiting">
            {fill(strings.propose.waitingCount, { n: waiting, max: PENDING_MAX })}
          </p>
        )}
      </>
    );
  } else if (props.mode === "create") {
    fields = (
      <>
        {pictureField}
        {nameField}
        {iconField}
        {translationsField}
      </>
    );
  } else {
    fields = (
      <>
        {nameField}
        {translationsField}
        {iconField}
        <div className="section-editor__field">
          <p className="section-editor__label">{strings.admin.picture}</p>
          {pictureField}
          {builtIn && <p className="section-editor__help">{strings.admin.builtInArt}</p>}
        </div>
      </>
    );
  }

  const failure =
    bar === null ? null : (
      <div className="section-editor__failed" role="alert">
        <p>
          {bar === "banned"
            ? strings.propose.banned
            : bar === "tooManyToday"
              ? fill(strings.propose.tooManyToday, { max: PROPOSALS_PER_DAY })
              : mode === "propose"
                ? strings.propose.failed
                : strings.admin.saveFailed}
        </p>
        {bar === "failed" && (
          <Button onClick={() => void submit()}>{strings.sections.tryAgain}</Button>
        )}
      </div>
    );

  const ask = (
    <div className="section-editor__actions section-editor__ask">
      <p className="section-editor__ask-text">
        {mode === "propose" ? strings.propose.discardAsk : strings.admin.discardChanges}
      </p>
      <Button onClick={() => setAsking(false)}>{strings.propose.keepEditing}</Button>
      <Button variant="danger" onClick={discard}>
        {strings.propose.discard}
      </Button>
    </div>
  );

  return createPortal(
    <div className={`scrim section-editor__scrim section-editor__scrim--${layout}`} onClick={close}>
      <form
        ref={box}
        className={`section-editor section-editor--${compact ? "full" : layout}`}
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
            {intro !== null && <p className="section-editor__intro">{intro}</p>}
          </header>
        )}
        <div className="section-editor__body" inert={sending}>
          {compact && intro !== null && <p className="section-editor__intro">{intro}</p>}
          {fields}
        </div>
        {(!compact || asking || failure !== null) && (
          <footer className="section-editor__foot">
            {failure}
            {asking ? (
              ask
            ) : compact ? null : (
              <div className="section-editor__actions">
                <Button onClick={close} disabled={sending}>
                  {strings.admin.cancel}
                </Button>
                {sendButton}
              </div>
            )}
          </footer>
        )}
        <p className="visually-hidden" aria-live="polite">
          {sending ? strings.propose.sending : ""}
        </p>
      </form>
    </div>,
    document.body,
  );
}
