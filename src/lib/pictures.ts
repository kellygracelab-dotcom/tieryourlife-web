import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage } from "./firebase";

/** The phone's numbers: the long side, the JPEG quality, and the bucket's ceiling. */
export const MAX_SIDE = 1000;
export const JPEG_QUALITY = 0.85;
export const MAX_BYTES = 4 * 1024 * 1024;

export type Shrink = (file: Blob) => Promise<Blob>;

/** Anything the canvas can draw, drawn no larger than the phone keeps it, as a JPEG. */
export const shrinkOnCanvas: Shrink = async (file) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("no image")) : resolve(blob)),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
};

export interface UploadedPicture {
  pictureId: string;
  /** Where the editor can show it from; the owner alone may read the folder. */
  previewUrl: string;
}

export type PictureFailure = "signIn" | "notAnImage" | "tooBig" | "upload";

export class PictureRefused extends Error {
  readonly reason: PictureFailure;

  constructor(reason: PictureFailure) {
    super(`picture refused: ${reason}`);
    this.name = "PictureRefused";
    this.reason = reason;
  }
}

export const picturePath = (uid: string, pictureId: string): string =>
  `users/${uid}/pictures/${pictureId}`;

/** Pictures belong to an account: a guest's folder would not follow a collision sign-in. */
function ownerUid(): string | null {
  const user = getFirebaseAuth().currentUser;
  return user === null || user.isAnonymous ? null : user.uid;
}

/**
 * One picture into the person's own folder, the one place a client may write.
 * Shrunk first, the way the phone does it, so a holiday photograph fits the
 * bucket's four megabytes and the feed's copy stays small.
 */
export async function uploadPicture(
  file: Blob,
  shrink: Shrink = shrinkOnCanvas,
  newId: () => string = () => crypto.randomUUID(),
): Promise<UploadedPicture> {
  const uid = ownerUid();
  if (uid === null) throw new PictureRefused("signIn");
  if (!file.type.startsWith("image/")) throw new PictureRefused("notAnImage");
  let bytes: Blob;
  try {
    bytes = await shrink(file);
  } catch {
    throw new PictureRefused("notAnImage");
  }
  if (bytes.size >= MAX_BYTES) throw new PictureRefused("tooBig");
  const pictureId = newId();
  const target = ref(getFirebaseStorage(), picturePath(uid, pictureId));
  try {
    await uploadBytes(target, bytes, { contentType: "image/jpeg" });
    return { pictureId, previewUrl: await getDownloadURL(target) };
  } catch {
    throw new PictureRefused("upload");
  }
}

/**
 * Once a list is live the feed has its own copies; the originals would only
 * sit in the private folder until a sweep, or forever. Best effort: a copy
 * that will not go is not worth failing anything over.
 */
export async function discardPictures(pictureIds: readonly string[]): Promise<void> {
  const uid = ownerUid();
  if (uid === null || pictureIds.length === 0) return;
  const storage = getFirebaseStorage();
  await Promise.all(
    pictureIds.map((pictureId) =>
      deleteObject(ref(storage, picturePath(uid, pictureId))).catch(() => undefined),
    ),
  );
}
