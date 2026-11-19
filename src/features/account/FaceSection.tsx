import { MediaImage } from "../../ui/MediaImage";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorOf } from "../../api/errors";
import type { ListSummary } from "../../api/types";
import {
  type CutFace,
  type FaceCut,
  PictureRefused,
  type UploadedPicture,
} from "../../lib/pictures";
import { useResource } from "../../lib/useResource";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { faceChoicesOf, samePicture } from "./faces";
import { type FaceSource, PlaceFaceDialog, type Placed } from "./PlaceFaceDialog";
import { SavedLine } from "./SavedLine";
import { type Publish, useSaving } from "./useSaving";
import { initialOf } from "../../lib/initial";
import { keepCardFace, readCardFace } from "../../lib/cardFace";
import type { MadeFace, PhotoSlot, RemovedPhoto, RestoredPhoto } from "../../api/community";
import { sayOnTheSite } from "../../ui/siteNotice";
import { storedPublicMedia } from "../../../functions/src/publicMedia";

export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Face = (photoUrl: string | null) => Promise<void>;
/** A face cut on this device, up to the person's own folder. */
export type UploadFace = (face: Blob) => Promise<UploadedPicture>;
/** The backend's copy of that photo, where everybody may see it, and the account's photo it now is. */
export type MakeFace = (
  pictureId: string,
  /** A photo from the device: the account's photo from then on. A card's cut is not. */
  upload: boolean,
) => Promise<{ url: string; photo?: MadeFace["photo"] }>;
/** The account's photo, what "Your photo" shows (Proxy #169). */
export type LoadPhoto = () => Promise<PhotoSlot | null>;
/** Takes the account's photo away everywhere; its copy waits ten minutes for Undo. */
export type RemovePhoto = () => Promise<RemovedPhoto>;
/** Undo of a removal: the photo back, worn again when it was. */
export type RestorePhoto = () => Promise<RestoredPhoto>;

/** A caption longer than this would be an ellipsis under a 64 px face; the name goes in the tooltip. */
const CAPTION_MAX = 12;

/**
 * Why a cut face did not become the face. A photo is named by its file; a
 * card's square has no name of its own.
 */
function faceFailureText(name: string | null, reason: unknown): string {
  if (reason instanceof PictureRefused) {
    if (reason.reason === "signIn") return strings.new.pictureSignIn;
    if (reason.reason === "uploadLimit") return strings.new.pictureUploadLimit;
    return name === null ? strings.settings.faceFailed : fill(strings.new.pictureFailed, { name });
  }
  const error = errorOf(reason);
  // An animation, or one SafeSearch could not judge (since 19.11.2026): a still photo will do.
  if (error.kind === "pictureRefused") {
    return error.because === "unchecked"
      ? strings.settings.faceUnchecked
      : strings.settings.faceNotMade;
  }
  return error.kind === "tooManyRequests" && error.code === "VISION_DAILY_LIMIT"
    ? strings.new.failedVisionToday
    : strings.settings.faceFailed;
}

export function FaceSection({
  uid,
  current,
  name,
  load,
  face,
  upload,
  makeFace,
  loadPhoto,
  removePhoto,
  restorePhoto,
  cut,
  show,
  publish,
  reread = async () => undefined,
}: {
  uid: string;
  current: string | null;
  name: string | null;
  load: LoadLists;
  face: Face;
  upload: UploadFace;
  makeFace: MakeFace;
  loadPhoto: LoadPhoto;
  removePhoto: RemovePhoto;
  restorePhoto: RestorePhoto;
  cut: CutFace;
  /** Puts a face on the account before Firebase has it; undefined puts the account's own back. */
  show: (photoUrl: string | null | undefined) => void;
  publish: Publish;
  /** The account's face as the server has it now, read again into the session. */
  reread?: () => Promise<void>;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state, retry } = useResource(uid, loadFor);
  const [saving, setSaving] = useSaving();
  const [placing, setPlacing] = useState<FaceSource | null>(null);
  const choices = state.status === "ready" ? faceChoicesOf(state.value.lists) : [];
  const busy = saving.status === "busy";
  const picker = useRef<HTMLInputElement>(null);
  // A card whose picture no longer loads is no choice: worn, it would be a
  // broken picture in the header. The face worn already stays in sight.
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());
  const offered = choices.filter(
    (choice) => !dead.has(choice.url) || samePicture(choice.url, current),
  );
  const [cardFace, setCardFace] = useState(() => readCardFace(uid));
  const cardWorn = cardFace !== null && samePicture(cardFace.face, current);
  const wears = (card: string) =>
    samePicture(card, current) || (cardWorn && cardFace.card === card);

  // The account's photo (Proxy #169): there whatever is worn, until a new
  // upload or Remove. Until the account has said, a face worn that is none
  // of the cards stands for it.
  const photoFor = useCallback(() => loadPhoto(), [loadPhoto]);
  const { state: photoState, retry: rereadPhoto } = useResource(uid, photoFor);
  // An upload or a removal made here since the account said.
  const [changed, setChanged] = useState<{ url: string | null } | null>(null);
  // Removed, while its Undo is still on the screen.
  const [hidden, setHidden] = useState<string | null>(null);
  const wornPhoto =
    state.status === "ready" &&
    current !== null &&
    !cardWorn &&
    !choices.some((choice) => samePicture(choice.url, current))
      ? current
      : null;
  const fromAccount =
    changed !== null
      ? changed.url
      : photoState.status === "ready"
        ? (photoState.value?.url ?? null)
        : wornPhoto;
  const ownPhoto = fromAccount !== null && fromAccount !== hidden ? fromAccount : null;

  // A photo is shown from an address of its own while it is placed, and only then.
  useEffect(() => {
    if (placing?.kind !== "photo") return;
    return () => URL.revokeObjectURL(placing.url);
  }, [placing]);

  const saved = async () => {
    setSaving({ status: "saved", publishing: true });
    await publish();
    show(undefined);
    setSaving({ status: "saved", publishing: false });
  };

  // The face on show changes the moment it is chosen; a change that fails
  // puts the account's own back and says why.
  const failed = (text?: string) => {
    show(undefined);
    setSaving({ status: "failed", text });
  };

  // An address someone else already hosts, or just the letter: no copy needed.
  const wearAtOnce = (url: string | null) => {
    show(url);
    setSaving({ status: "busy" });
    face(url).then(saved, () => failed());
  };

  // The phone's way with anything placed by hand or from the device: cut on
  // this device, up to the person's own folder, checked and copied by the
  // backend, then on the account like any face. Shown from the cut at once.
  const cutAndSend = async (placed: Placed, from: string | null, card: string | null) => {
    let cutFace: FaceCut;
    try {
      cutFace = cut(placed.picture, placed.square);
    } catch {
      failed(strings.settings.faceNotMade);
      return;
    }
    show(cutFace.shown);
    setSaving({ status: "busy" });
    try {
      const { pictureId } = await upload(await cutFace.bytes);
      const made = await makeFace(pictureId, card === null);
      await face(made.url);
      // What the account now keeps as its photo: the upload. A card's cut is
      // its card's tile, and leaves the photo be.
      const photo = made.photo ?? null;
      if (photo !== null) setChanged({ url: photo.url });
      else if (card === null) setChanged({ url: made.url });
      setHidden(null);
      if (card !== null) {
        keepCardFace(uid, { card, face: made.url });
        setCardFace({ card, face: made.url });
      }
      await saved();
    } catch (reason: unknown) {
      failed(faceFailureText(from, reason));
      if (card === null) resync();
    }
  };

  const place = (source: FaceSource) => {
    if (!busy) setPlacing(source);
  };

  const fromDevice = (file: File) => {
    if (busy) return;
    if (!file.type.startsWith("image/")) {
      setSaving({ status: "failed", text: fill(strings.new.pictureNotImage, { name: file.name }) });
      return;
    }
    place({ kind: "photo", url: URL.createObjectURL(file), name: file.name });
  };

  // A catalogue's card left in the middle is worn where it lives; a photo, a
  // card moved or zoomed, or one of the feed's copies (gone with a republish)
  // is cut first. The cut is drawn before the dialog goes.
  const use = (placed: Placed | null) => {
    if (placing === null) return;
    const card = placing.kind === "card" ? placing.url : null;
    if (placed !== null && (card === null || placed.moved || storedPublicMedia(card) !== null)) {
      void cutAndSend(placed, placing.kind === "photo" ? placing.name : null, card);
    } else if (placing.kind === "card") {
      wearAtOnce(placing.url);
    }
    setPlacing(null);
  };

  // Undo of a removal: the account puts the photo back, and it is worn again
  // when it was, as from its tile. Too late says so; one uploaded since stays.
  const undoRemoval = async () => {
    setSaving({ status: "busy" });
    let back: RestoredPhoto;
    try {
      back = await restorePhoto();
    } catch {
      failed();
      return;
    }
    if (back.kind === "gone") {
      setSaving({ status: "failed", text: strings.settings.facePhotoGone });
      return;
    }
    if (back.photo !== null) setChanged({ url: back.photo.url });
    if (back.kind === "restored" && back.wasWorn) wearAtOnce(back.photo.url);
    else await saved();
  };

  // Remove your photo (Proxy #170): sent at once, and gone from everywhere it
  // showed; the letter is worn if it was. Undo stays on the screen a while;
  // the account keeps the photo ten minutes for it.
  const removeOwnPhoto = () => {
    if (ownPhoto === null || busy) return;
    const was = ownPhoto;
    setHidden(was);
    if (samePicture(current, was)) show(null);
    setSaving({ status: "busy" });
    removePhoto().then(
      async (removed) => {
        setChanged({ url: null });
        setHidden(null);
        // The backend took it off the account already; this browser's sign-in learns it.
        if (removed.wasWorn || samePicture(current, was)) await face(null).catch(() => undefined);
        await saved();
        sayOnTheSite({
          text: strings.settings.facePhotoRemoved,
          long: true,
          action: { text: strings.settings.faceUndo, onClick: () => void undoRemoval() },
        });
      },
      () => {
        setHidden(null);
        failed();
        resync();
      },
    );
  };

  // A photo change the server failed may still have been made there (QA
  // 19.11, D12): the slot and the face are read again, and what the account
  // has is shown rather than what this page guessed.
  const resync = () => {
    setChanged(null);
    rereadPhoto();
    void reread()
      .catch(() => undefined)
      .then(() => show(undefined));
  };

  const unreadable = () => {
    if (placing?.kind === "photo") {
      setSaving({
        status: "failed",
        text: fill(strings.new.pictureNotImage, { name: placing.name }),
      });
    }
    setPlacing(null);
  };

  return (
    <section className="settings__card" aria-labelledby="face-title">
      <h2 id="face-title" className="settings__title">
        {strings.settings.faceTitle}
      </h2>
      <p className="settings__helper">{strings.settings.faceBody}</p>
      <ul className="settings__faces" aria-label={strings.settings.faceChoices}>
        <li className="settings__face">
          <button
            type="button"
            className="settings__choice settings__choice--letter"
            aria-label={strings.settings.faceLetter}
            aria-pressed={current === null}
            onClick={() => {
              if (current !== null && !busy) wearAtOnce(null);
            }}
          >
            {initialOf(name)}
            {current === null && <Icon name="check" className="settings__choice-check" />}
          </button>
          <span className="settings__face-from">{strings.settings.faceLetterCaption}</span>
        </li>
        {ownPhoto !== null && (
          <li className="settings__face">
            <button
              type="button"
              className="settings__choice"
              aria-label={strings.settings.facePhotoCaption}
              aria-pressed={samePicture(current, ownPhoto) && !cardWorn}
              onClick={() => {
                if ((!samePicture(current, ownPhoto) || cardWorn) && !busy) wearAtOnce(ownPhoto);
              }}
            >
              <MediaImage src={ownPhoto} alt="" loading="lazy" />
              {samePicture(current, ownPhoto) && !cardWorn && (
                <Icon name="check" className="settings__choice-check" />
              )}
            </button>
            <span className="settings__face-from">{strings.settings.facePhotoCaption}</span>
          </li>
        )}
        <li className="settings__face">
          <input
            ref={picker}
            type="file"
            accept="image/*"
            className="settings__picker"
            aria-label={strings.settings.faceGallery}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) fromDevice(file);
            }}
          />
          <button
            type="button"
            className="settings__choice settings__choice--photo"
            title={strings.settings.faceGallery}
            aria-hidden="true"
            tabIndex={-1}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <Icon name="upload" />
          </button>
          <span className="settings__face-from">{strings.settings.faceGalleryCaption}</span>
        </li>
        {offered.map((choice) => (
          <li key={choice.url} className="settings__face">
            <button
              type="button"
              className="settings__choice"
              aria-label={fill(strings.settings.faceChoice, { list: choice.from })}
              title={choice.from}
              aria-pressed={wears(choice.url)}
              onClick={() => place({ kind: "card", url: choice.url })}
            >
              <MediaImage
                src={choice.url}
                alt=""
                loading="lazy"
                onError={() => setDead((gone) => new Set(gone).add(choice.url))}
              />
              {wears(choice.url) && <Icon name="check" className="settings__choice-check" />}
            </button>
            {choice.from.length <= CAPTION_MAX && (
              <span className="settings__face-from">{choice.from}</span>
            )}
          </li>
        ))}
        {state.status === "loading" && (
          <li className="settings__face" aria-busy="true">
            <Skeleton height="64px" width="64px" className="settings__choice-placeholder" />
          </li>
        )}
        {/* In the row, where the wait was: under it, the card grew when it came. */}
        {state.status === "ready" && choices.length === 0 && (
          <li className="settings__face settings__face--none">
            <p className="settings__helper">{strings.settings.faceNone}</p>
          </li>
        )}
        {state.status === "error" && (
          <li className="settings__face settings__face--none">
            <p className="settings__error" role="alert">
              <Icon name="cloud_off" className="settings__error-icon" />
              {strings.settings.faceListsFailed}
              <button type="button" className="settings__retry" onClick={retry}>
                {strings.settings.tryAgain}
              </button>
            </p>
          </li>
        )}
      </ul>
      {ownPhoto !== null && (
        <button
          type="button"
          className="btn btn--text settings__remove-photo"
          disabled={busy}
          onClick={removeOwnPhoto}
        >
          <span>{strings.settings.faceRemovePhoto}</span>
        </button>
      )}
      <p className="settings__helper">{strings.settings.faceNote}</p>
      {/* The face on show is already the new one; until the account has it, the card says so. */}
      {busy && (
        <p className="settings__saved" role="status">
          {strings.settings.saving}
        </p>
      )}
      {saving.status === "failed" && (
        <p className="settings__error" role="alert">
          <Icon name="cloud_off" className="settings__error-icon" />
          {saving.text ?? strings.settings.faceFailed}
        </p>
      )}
      <SavedLine state={saving} />
      {placing !== null && (
        <PlaceFaceDialog
          source={placing}
          onCancel={() => setPlacing(null)}
          onUse={use}
          onUnreadable={unreadable}
        />
      )}
    </section>
  );
}
