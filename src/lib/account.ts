import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export type Account =
  | { kind: "guest"; uid: string | null }
  | { kind: "signedIn"; uid: string; displayName: string | null; photoUrl: string | null };

// The proxy shows an author's face only from an https address, so the site
// never holds anything else.
const httpsOnly = (url: string | null): string | null =>
  url !== null && url.startsWith("https://") ? url : null;

export function accountOf(user: User | null): Account {
  if (user === null) return { kind: "guest", uid: null };
  if (user.isAnonymous) return { kind: "guest", uid: user.uid };
  return {
    kind: "signedIn",
    uid: user.uid,
    displayName: user.displayName,
    photoUrl: httpsOnly(user.photoURL),
  };
}

export function subscribeToAccount(listener: (account: Account) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => listener(accountOf(user)));
}
