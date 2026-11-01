import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { errorOf } from "../api/errors";
import { getFirebaseAuth, getFirebaseStorage } from "./firebase";
import type { PixelRect, Size } from "./framing";

/**
 * A card's picture is a poster: a tile shows it at 64 px, the share image at
 * 96, a list's cover at about 400. A long side of 640 serves all of them at
 * twice the size, and keeps a photograph to some 50 KB, so a dozen go up in
 * seconds. (The phone keeps 1000; the bucket's ceiling is the same.)
 */
export const MAX_SIDE = 640;
export const JPEG_QUALITY = 0.8;
export const MAX_BYTES = 4 * 1024 * 1024;

export type Shrink = (file: Blob) => Promise<Blob>;

/** Anything the canvas can draw, drawn no larger than a card needs it, as a JPEG. */
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
  // A photograph shrinks five times or more; the default smoothing leaves it grainy.
  context.imageSmoothingQuality = "high";
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

/** A face is cut to this square on the device, as the phone cuts it, before it goes up. */
export const FACE_EDGE = 256;

/** A square of a picture, in the picture's own pixels. */
export interface PixelSquare {
  left: number;
  top: number;
  side: number;
}

/** A face cut on this device: an address to show it from at once, and the bytes to send up. */
export interface FaceCut {
  shown: string;
  bytes: Promise<Blob>;
}

export type CutFace = (picture: CanvasImageSource, square: PixelSquare) => FaceCut;

/**
 * The square drawn at FACE_EDGE as a JPEG. The drawing is done at once, so
 * the face can be shown in the same frame it was chosen in; it throws for a
 * picture whose host does not let the page read it.
 */
export const cutFaceOnCanvas: CutFace = (picture, square) => {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_EDGE;
  canvas.height = FACE_EDGE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.imageSmoothingQuality = "high";
  const { left, top, side } = square;
  context.drawImage(picture, left, top, side, side, 0, 0, FACE_EDGE, FACE_EDGE);
  const shown = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const bytes = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("no image")) : resolve(blob)),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
  return { shown, bytes };
};

/**
 * A section's picture as it goes up (docs/design-spec-admin.md, 2.3): 16:10,
 * 1600 × 1000 at most, as the app sends, and never below 960 × 600, the
 * backend's floor. A crop with fewer pixels than the most goes up at its own
 * width rather than blown up; one below the floor is drawn up to it.
 */
export const SECTION_PICTURE_MAX: Size = { width: 1600, height: 1000 };
export const SECTION_PICTURE_MIN: Size = { width: 960, height: 600 };
export const WEBP_QUALITY = 0.85;

/** The size a crop of this many pixels across goes up at: a multiple of 8, so 16:10 is exact. */
export function sectionPictureSize(cropWidth: number): Size {
  const width = Math.min(
    SECTION_PICTURE_MAX.width,
    Math.max(SECTION_PICTURE_MIN.width, Math.floor(cropWidth / 8) * 8),
  );
  return { width, height: (width / 16) * 10 };
}

/** The part of a picture inside a frame, drawn at the size it goes up at, as its bytes. */
export type CropPicture = (picture: CanvasImageSource, crop: PixelRect) => Promise<Blob>;

const blobOf = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("no image")) : resolve(blob)),
      type,
      quality,
    );
  });

/**
 * A section's crop as a WebP. A browser that cannot write WebP hands back a
 * PNG instead, several times the size; a JPEG of the same quality goes up
 * then. The bytes carry their own type, and the upload names it.
 */
export const cropSectionOnCanvas: CropPicture = async (picture, crop) => {
  const size = sectionPictureSize(crop.width);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    picture,
    crop.left,
    crop.top,
    crop.width,
    crop.height,
    0,
    0,
    size.width,
    size.height,
  );
  const webp = await blobOf(canvas, "image/webp", WEBP_QUALITY);
  return webp.type === "image/webp" ? webp : blobOf(canvas, "image/jpeg", WEBP_QUALITY);
};

/** A picture as text, for keeping in the tab's storage: a data: address. */
export const dataUrlOf = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unread"));
    reader.onerror = () => reject(reader.error ?? new Error("unread"));
    reader.readAsDataURL(blob);
  });

export interface UploadedPicture {
  pictureId: string;
  /** Where the editor can show it from; the owner alone may read the folder. */
  previewUrl: string;
}

/** dailyLimit: the backend copies only so many web pictures a day for one person. */
export type PictureFailure = "signIn" | "notAnImage" | "tooBig" | "upload" | "dailyLimit";

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

/** Where one of the person's own pictures can be seen from, or null when it cannot be found. */
export const ownPictureUrl = (uid: string, pictureId: string): Promise<string | null> =>
  getDownloadURL(ref(getFirebaseStorage(), picturePath(uid, pictureId))).catch(() => null);

/** Pictures belong to an account: a guest's folder would not follow a collision sign-in. */
function ownerUid(): string | null {
  const user = getFirebaseAuth().currentUser;
  return user === null || user.isAnonymous ? null : user.uid;
}

/**
 * One picture into the person's own folder, the one place a client may write.
 * Shrunk first, the way the phone does it, so a holiday photograph fits the
 * bucket's four megabytes and the feed's copy stays small. A caller with its
 * bytes already made (a face's square, a section's WebP crop) hands in a
 * shrink that returns them; they go up as the type they say they are.
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
    await uploadBytes(target, bytes, {
      contentType: bytes.type.startsWith("image/") ? bytes.type : "image/jpeg",
    });
    return { pictureId, previewUrl: await getDownloadURL(target) };
  } catch {
    throw new PictureRefused("upload");
  }
}

const KEPT_REFUSALS: Partial<Record<string, PictureFailure>> = {
  NOT_A_PICTURE: "notAnImage",
  TOO_BIG: "tooBig",
  KEEP_LIMIT: "dailyLimit",
};

/**
 * A picture found on the web, made one of the person's own by the backend
 * (a browser may not read another site's bytes): the card keeps it whatever
 * that site does, as it keeps an upload. Shown from the copy, or from where it
 * was found while the copy's address cannot be had.
 */
export async function keepWebPicture(
  url: string,
  keep: (url: string) => Promise<string>,
): Promise<UploadedPicture> {
  const uid = ownerUid();
  if (uid === null) throw new PictureRefused("signIn");
  let pictureId: string;
  try {
    pictureId = await keep(url);
  } catch (failure) {
    const why = errorOf(failure);
    throw new PictureRefused(
      why.kind === "pictureRefused" ? (KEPT_REFUSALS[why.because ?? ""] ?? "upload") : "upload",
    );
  }
  return { pictureId, previewUrl: (await ownPictureUrl(uid, pictureId)) ?? url };
}

/** The id of a picture the backend copied for this list, when the address is one of those. */
export function publishedPictureOf(url: string, listId: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "firebasestorage.googleapis.com") return null;
  const match = /^\/v0\/b\/[^/]+\/o\/(.+)$/.exec(parsed.pathname);
  if (match === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  const [folder, owner, pictureId, ...rest] = path.split("/");
  return folder === "published" &&
    owner === listId &&
    pictureId !== undefined &&
    rest.length === 0 &&
    /^[A-Za-z0-9_-]+$/.test(pictureId)
    ? pictureId
    : null;
}

/**
 * The feed's copy brought back into the private folder under a new id, so a
 * republish can name it: the backend keeps only the copies the new snapshot
 * names, and it names them by id, never by address.
 */
export async function copyPublishedBack(
  url: string,
  newId: () => string = () => crypto.randomUUID(),
): Promise<UploadedPicture> {
  const uid = ownerUid();
  if (uid === null) throw new PictureRefused("signIn");
  let bytes: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    bytes = await response.blob();
  } catch {
    throw new PictureRefused("upload");
  }
  const pictureId = newId();
  const target = ref(getFirebaseStorage(), picturePath(uid, pictureId));
  try {
    await uploadBytes(target, bytes, {
      contentType: bytes.type.startsWith("image/") ? bytes.type : "image/jpeg",
    });
    // Shown from the copy: the feed's goes once the list is sent again.
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
