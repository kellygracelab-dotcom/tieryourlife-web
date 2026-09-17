import { updateProfile, type User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

/** The app's ceiling for a nickname. */
export const NAME_MAX = 24;

export class NotSignedIn extends Error {
  constructor() {
    super("not signed in");
    this.name = "NotSignedIn";
  }
}

function signedInUser(): User {
  const user = getFirebaseAuth().currentUser;
  if (user === null || user.isAnonymous) throw new NotSignedIn();
  return user;
}

/** Trimmed and cut to the ceiling; empty means the Google name comes back. */
export const tidyName = (name: string): string =>
  name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

/**
 * The name the community sees, on the Firebase user, the way the phone sets
 * it. The ID token is refreshed so the backend reads the new claims on the
 * next call.
 */
export async function renameAccount(name: string): Promise<string> {
  const user = signedInUser();
  const displayName = tidyName(name);
  await updateProfile(user, { displayName });
  await user.getIdToken(true);
  return displayName;
}

/** An https address someone else already hosts, or nothing: just the letter. */
export async function setFace(photoURL: string | null): Promise<void> {
  const user = signedInUser();
  await updateProfile(user, { photoURL: photoURL ?? "" });
  await user.getIdToken(true);
}
