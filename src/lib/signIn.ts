import { FirebaseError } from "firebase/app";
import {
  browserPopupRedirectResolver,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import { localStorageStore } from "../features/board/draft";
import { claimKeptRankings } from "../features/ranking/claim";
import { carryGuest } from "./api";
import { getFirebaseAuth } from "./firebase";
import { IN_APP_BROWSER, isInAppBrowser } from "./inAppBrowser";

export type SignInOutcome =
  /** `switched` when the Google account already existed and the guest was carried over to it. */
  | { kind: "signedIn"; switched: boolean }
  | { kind: "redirecting" }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string };

export interface SignInDeps {
  carry: (guestToken: string) => Promise<unknown>;
  /** Hands the rankings this device finished to the account that signed in. */
  keep: (uid: string) => Promise<unknown>;
  stash: Stash;
  /** Whether this is a browser embedded in another app, where Google refuses to sign anyone in. */
  inApp: () => boolean;
}

/** Where the guest's token waits while a redirect sign-in leaves and comes back. */
export interface Stash {
  take(): string | null;
  put(token: string): void;
}

const CODE = {
  inUse: "auth/credential-already-in-use",
  popupBlocked: "auth/popup-blocked",
  popupClosed: "auth/popup-closed-by-user",
  popupCancelled: "auth/cancelled-popup-request",
  unsupported: "auth/operation-not-supported-in-this-environment",
} as const;

const STASH_KEY = "tyl:signin:guest";

// A private window may refuse sessionStorage; a lost token only means nothing
// is carried over, and the sign-in itself still goes through.
export const sessionStash: Stash = {
  take: () => {
    try {
      const token = window.sessionStorage.getItem(STASH_KEY);
      window.sessionStorage.removeItem(STASH_KEY);
      return token;
    } catch {
      return null;
    }
  },
  put: (token) => {
    try {
      window.sessionStorage.setItem(STASH_KEY, token);
    } catch {
      return;
    }
  },
};

const defaultDeps: SignInDeps = {
  carry: carryGuest,
  keep: (uid) => claimKeptRankings(localStorageStore, uid),
  stash: sessionStash,
  inApp: () => isInAppBrowser(navigator.userAgent),
};

const codeOf = (error: unknown): string =>
  error instanceof FirebaseError ? error.code : "unknown";

function google(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

// Linking Google onto a guest leaves the top-level profile empty, and the
// backend reads the author's name and picture from the token claims.
async function adoptProfile(user: User): Promise<void> {
  if (user.displayName === null || user.photoURL === null) {
    const account = user.providerData.find((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID);
    if (account !== undefined) {
      await updateProfile(user, {
        displayName: user.displayName ?? account.displayName,
        photoURL: user.photoURL ?? account.photoURL,
      });
    }
  }
  await user.getIdToken(true);
}

async function switchAccount(
  auth: Auth,
  error: FirebaseError,
  guestToken: string | null,
  deps: SignInDeps,
): Promise<SignInOutcome> {
  const credential = GoogleAuthProvider.credentialFromError(error);
  if (credential === null) return { kind: "failed", code: error.code };
  const { user } = await signInWithCredential(auth, credential);
  await adoptProfile(user);
  if (guestToken !== null) {
    await deps.carry(guestToken).catch(() => undefined);
  }
  await deps.keep(user.uid).catch(() => undefined);
  return { kind: "signedIn", switched: true };
}

/**
 * Google sign-in the way the phone app does it: the guest is linked so its uid
 * and everything under it stay; when the Google account already exists, the
 * person is signed into it and the guest is carried over.
 */
export async function signInWithGoogle(deps: SignInDeps = defaultDeps): Promise<SignInOutcome> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (user !== null && !user.isAnonymous) return { kind: "signedIn", switched: false };
  // Not even tried there: the popup fails, and the redirect it falls back to
  // ends on Google's "disallowed_useragent" page with no way back.
  if (deps.inApp()) return { kind: "failed", code: IN_APP_BROWSER };
  // Taken before linking: afterwards the guest may be gone from this session.
  const guestToken = user === null ? null : await user.getIdToken();
  try {
    // The resolver comes here, not with the Auth instance: see getFirebaseAuth().
    const result =
      user === null
        ? await signInWithPopup(auth, google(), browserPopupRedirectResolver)
        : await linkWithPopup(user, google(), browserPopupRedirectResolver);
    await adoptProfile(result.user);
    await deps.keep(result.user.uid).catch(() => undefined);
    return { kind: "signedIn", switched: false };
  } catch (error) {
    const code = codeOf(error);
    if (code === CODE.inUse && error instanceof FirebaseError) {
      return switchAccount(auth, error, guestToken, deps);
    }
    if (code === CODE.popupClosed || code === CODE.popupCancelled) return { kind: "cancelled" };
    if (code === CODE.popupBlocked || code === CODE.unsupported) {
      if (guestToken !== null) deps.stash.put(guestToken);
      if (user === null) await signInWithRedirect(auth, google(), browserPopupRedirectResolver);
      else await linkWithRedirect(user, google(), browserPopupRedirectResolver);
      return { kind: "redirecting" };
    }
    return { kind: "failed", code };
  }
}

/** Finishes a sign-in that left through a redirect. On an ordinary visit there is nothing to finish. */
export async function completeSignIn(
  deps: SignInDeps = defaultDeps,
): Promise<SignInOutcome | null> {
  const auth = getFirebaseAuth();
  const guestToken = deps.stash.take();
  try {
    const result = await getRedirectResult(auth, browserPopupRedirectResolver);
    if (result === null) return null;
    await adoptProfile(result.user);
    await deps.keep(result.user.uid).catch(() => undefined);
    return { kind: "signedIn", switched: false };
  } catch (error) {
    if (codeOf(error) === CODE.inUse && error instanceof FirebaseError) {
      return switchAccount(auth, error, guestToken, deps);
    }
    return { kind: "failed", code: codeOf(error) };
  }
}
