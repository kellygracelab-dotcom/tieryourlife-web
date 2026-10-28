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

export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Face = (photoUrl: string | null) => Promise<void>;
/** A face cut on this device, up to the person's own folder. */
export type UploadFace = (face: Blob) => Promise<UploadedPicture>;
/** The backend's copy of that photo, where everybody may see it. */
export type MakeFace = (pictureId: string) => Promise<{ url: string }>;

/** A caption longer than this would be an ellipsis under a 64 px face; the name goes in the tooltip. */
const CAPTION_MAX = 12;

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

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
  const { state } = useResource(uid, loadFor);
  const [saving, setSaving] = useSaving();
  const [placing, setPlacing] = useState<FaceSource | null>(null);
  const choices = state.status === "ready" ? faceChoicesOf(state.value.lists) : [];
  const busy = saving.status === "busy";
  const picker = useRef<HTMLInputElement>(null);

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
  const cutAndSend = async (placed: Placed, from: string | null) => {
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

  // A card left in the middle is worn where it lives; a photo, or a card
  // moved or zoomed, is cut first. The cut is drawn before the dialog goes.
  const use = (placed: Placed | null) => {
    if (placing === null) return;
    if (placed !== null && (placing.kind === "photo" || placed.moved)) {
      void cutAndSend(placed, placing.kind === "photo" ? placing.name : null);
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

  // A photo already chosen is none of the cards: it shows as its own choice.
  const photo = current !== null && !choices.some((choice) => choice.url === current);

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
        {photo && (
          <li className="settings__face">
            <button
              type="button"
              className="settings__choice"
              aria-label={strings.settings.facePhotoCaption}
              aria-pressed="true"
            >
              <img src={current} alt="" loading="lazy" />
              <Icon name="check" className="settings__choice-check" />
            </button>
            <span className="settings__face-from">{strings.settings.facePhotoCaption}</span>
          </li>
        )}
        {choices.map((choice) => (
          <li key={choice.url} className="settings__face">
            <button
              type="button"
              className="settings__choice"
              aria-label={fill(strings.settings.faceChoice, { list: choice.from })}
              title={choice.from}
              aria-pressed={choice.url === current}
              onClick={() => place({ kind: "card", url: choice.url })}
            >
              <img src={choice.url} alt="" loading="lazy" />
              {choice.url === current && <Icon name="check" className="settings__choice-check" />}
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
      </ul>
      {state.status === "ready" && choices.length === 0 && (
        <p className="settings__helper">{strings.settings.faceNone}</p>
      )}
      <p className="settings__helper">{strings.settings.faceNote}</p>
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
