import { useCallback, useRef } from "react";
import { errorOf } from "../../api/errors";
import type { ListSummary } from "../../api/types";
import { PictureRefused, type UploadedPicture } from "../../lib/pictures";
import { useResource } from "../../lib/useResource";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { faceChoicesOf } from "./faces";
import { SavedLine } from "./SavedLine";
import { type Publish, useSaving } from "./useSaving";

export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Face = (photoUrl: string | null) => Promise<void>;
/** A photo from the device into the person's own folder. */
export type UploadFace = (file: File) => Promise<UploadedPicture>;
/** The backend's copy of that photo, where everybody may see it. */
export type MakeFace = (pictureId: string) => Promise<{ url: string }>;

/** A caption longer than this would be an ellipsis under a 64 px face; the name goes in the tooltip. */
const CAPTION_MAX = 12;

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

/** Why a photo could not become the face, in the words the editor uses for its pictures. */
function faceFailureText(name: string, reason: unknown): string {
  if (reason instanceof PictureRefused) {
    switch (reason.reason) {
      case "signIn":
        return strings.new.pictureSignIn;
      case "notAnImage":
        return fill(strings.new.pictureNotImage, { name });
      case "tooBig":
        return fill(strings.new.pictureTooBig, { name });
      default:
        return fill(strings.new.pictureFailed, { name });
    }
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
  publish,
}: {
  uid: string;
  current: string | null;
  name: string | null;
  load: LoadLists;
  face: Face;
  upload: UploadFace;
  makeFace: MakeFace;
  publish: Publish;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state } = useResource(uid, loadFor);
  const [saving, setSaving] = useSaving();
  const choices = state.status === "ready" ? faceChoicesOf(state.value.lists) : [];
  const busy = saving.status === "busy";
  const picker = useRef<HTMLInputElement>(null);

  const saved = async () => {
    setSaving({ status: "saved", publishing: true });
    await publish();
    setSaving({ status: "saved", publishing: false });
  };

  // The choice on show comes from the account, never from the click, so a
  // refused change snaps back by itself.
  const choose = (url: string | null) => {
    if (url === current || busy) return;
    setSaving({ status: "busy" });
    face(url).then(saved, () => setSaving({ status: "failed" }));
  };

  // The phone's "A photo from the gallery": up to the person's own folder,
  // checked and copied by the backend, then on the account like any face.
  const fromPhoto = async (file: File) => {
    if (busy) return;
    setSaving({ status: "busy" });
    try {
      const { pictureId } = await upload(file);
      const { url } = await makeFace(pictureId);
      await face(url);
      await saved();
    } catch (reason: unknown) {
      setSaving({ status: "failed", text: faceFailureText(file.name, reason) });
    }
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
            onClick={() => choose(null)}
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
              if (file !== undefined) void fromPhoto(file);
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
              onClick={() => choose(choice.url)}
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
    </section>
  );
}
