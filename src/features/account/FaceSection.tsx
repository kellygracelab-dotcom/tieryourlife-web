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
import { faceChoicesOf } from "./faces";
import { type FaceSource, PlaceFaceDialog, type Placed } from "./PlaceFaceDialog";
import { SavedLine } from "./SavedLine";
import { type Publish, useSaving } from "./useSaving";
import { initialOf } from "../../lib/initial";
import { keepCardFace, keepOwnFace, readCardFace, readOwnFace } from "../../lib/ownFace";

export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Face = (photoUrl: string | null) => Promise<void>;
/** A face cut on this device, up to the person's own folder. */
export type UploadFace = (face: Blob) => Promise<UploadedPicture>;
/** The backend's copy of that photo, where everybody may see it. */
export type MakeFace = (pictureId: string) => Promise<{ url: string }>;

/** A caption longer than this would be an ellipsis under a 64 px face; the name goes in the tooltip. */
const CAPTION_MAX = 12;

/**
 * Why a cut face did not become the face. A photo is named by its file; a
 * card's square has no name of its own.
 */
function faceFailureText(name: string | null, reason: unknown): string {
  if (reason instanceof PictureRefused) {
    if (reason.reason === "signIn") return strings.new.pictureSignIn;
    return name === null ? strings.settings.faceFailed : fill(strings.new.pictureFailed, { name });
  }
  return errorOf(reason).kind === "pictureRefused"
    ? strings.settings.faceNotMade
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
  cut,
  show,
  publish,
}: {
  uid: string;
  current: string | null;
  name: string | null;
  load: LoadLists;
  face: Face;
  upload: UploadFace;
  makeFace: MakeFace;
  cut: CutFace;
  /** Puts a face on the account before Firebase has it; undefined puts the account's own back. */
  show: (photoUrl: string | null | undefined) => void;
  publish: Publish;
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
  const offered = choices.filter((choice) => !dead.has(choice.url) || choice.url === current);
  // The uploaded photo's slot. A face worn that is none of the cards takes
  // it too: put on from another device, or before the slot was kept.
  const [slot, setSlot] = useState(() => readOwnFace(uid));
  const [cardFace, setCardFace] = useState(() => readCardFace(uid));
  const wears = (card: string) =>
    card === current || (cardFace !== null && cardFace.card === card && cardFace.face === current);
  const wornPhoto =
    state.status === "ready" &&
    current !== null &&
    current !== cardFace?.face &&
    !choices.some((choice) => choice.url === current)
      ? current
      : null;
  const ownPhoto = wornPhoto ?? slot;
  useEffect(() => {
    if (wornPhoto !== null && wornPhoto !== readOwnFace(uid)) keepOwnFace(uid, wornPhoto);
  }, [uid, wornPhoto]);
  const remember = (url: string) => {
    keepOwnFace(uid, url);
    setSlot(url);
  };

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
      const { url } = await makeFace(pictureId);
      await face(url);
      // A photo takes the photo's slot; a card's cut is its card's, and leaves the photo be.
      if (card === null) remember(url);
      else {
        keepCardFace(uid, { card, face: url });
        setCardFace({ card, face: url });
      }
      await saved();
    } catch (reason: unknown) {
      failed(faceFailureText(from, reason));
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

  // A card left in the middle is worn where it lives, the feed's copy too:
  // every cut goes up as the account's photo since Proxy #169, and a card
  // must not take the photo's place. A photo, or a card moved or zoomed, is
  // cut first. The cut is drawn before the dialog goes.
  const use = (placed: Placed | null) => {
    if (placing === null) return;
    const card = placing.kind === "card" ? placing.url : null;
    if (placed !== null && (card === null || placed.moved)) {
      void cutAndSend(placed, placing.kind === "photo" ? placing.name : null, card);
    } else if (placing.kind === "card") {
      wearAtOnce(placing.url);
    }
    setPlacing(null);
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
              aria-pressed={current === ownPhoto}
              onClick={() => {
                if (current !== ownPhoto && !busy) wearAtOnce(ownPhoto);
              }}
            >
              <MediaImage src={ownPhoto} alt="" loading="lazy" />
              {current === ownPhoto && <Icon name="check" className="settings__choice-check" />}
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
