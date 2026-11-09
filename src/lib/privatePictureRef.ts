import { firebaseConfig } from "./firebaseConfig";

export const MAX_PICTURE_BYTES = 4 * 1024 * 1024;
const prefix =
  "https://firebasestorage.googleapis.com/v0/b/" + firebaseConfig.storageBucket + "/o/";
export const picturePath = (uid: string, pictureId: string) => `users/${uid}/pictures/${pictureId}`;

/** A persistent reference for the board. Private images read its object through the SDK. */
export const ownPictureRef = (uid: string, pictureId: string) =>
  prefix + encodeURIComponent(picturePath(uid, pictureId)) + "?alt=media";

export function privatePicturePath(url: string | null | undefined): string | null {
  if (!url?.startsWith(prefix)) return null;
  try {
    const path = decodeURIComponent(url.slice(prefix.length).split(/[?#]/, 1)[0]!);
    return /^users\/[^/\\]+\/pictures\/[^/\\]+$/.test(path) ? path : null;
  } catch {
    return null;
  }
}
