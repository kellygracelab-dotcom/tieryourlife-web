import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { owners } from "../features/boards/owners";
import { claimKeptRankings } from "../features/ranking/claim";
import { currentAccount, subscribeToAccount, type Account } from "../lib/account";
import { noteSignedIn } from "../lib/signedInHint";
import { carryGuest } from "../lib/api";
import { signOutToGuest } from "../lib/firebase";
import { isInAppBrowser } from "../lib/inAppBrowser";
import {
  completeSignIn,
  sessionStash,
  signInWithGoogle,
  type SignInDeps,
  type SignInOutcome,
} from "../lib/signIn";
import { localStorageStore } from "../lib/storage";
import { RedirectFailedContext, SessionContext, ShowFaceContext } from "./session";

interface SessionProviderProps {
  children: ReactNode;
  subscribe?: (listener: (account: Account) => void) => () => void;
  signIn?: () => Promise<SignInOutcome>;
  signOut?: () => Promise<void>;
  complete?: () => Promise<unknown>;
  current?: () => Account;
}

// What signing in touches beyond Firebase: the guest's credits, the rankings
// this device finished, the redirect's stash. Gathered here, where the app is
// put together, so lib/ knows no feature.
const signInDeps: SignInDeps = {
  carry: carryGuest,
  keep: (uid) => claimKeptRankings(localStorageStore, uid),
  stash: sessionStash,
  inApp: () => isInAppBrowser(navigator.userAgent),
};
const defaultSignIn = () => signInWithGoogle(signInDeps);
const kindOf = (outcome: unknown): SignInOutcome["kind"] | null =>
  typeof outcome === "object" && outcome !== null ? (outcome as SignInOutcome).kind : null;
const defaultComplete = () => completeSignIn(signInDeps);

export function SessionProvider({
  children,
  subscribe = subscribeToAccount,
  signIn = defaultSignIn,
  signOut = signOutToGuest,
  complete = defaultComplete,
  current = currentAccount,
}: SessionProviderProps) {
  const [account, setAccount] = useState<Account | null>(null);
  // A face chosen a moment ago and still on its way to Firebase.
  const [shownFace, showFace] = useState<string | null | undefined>(undefined);
  const [redirectFailed, setRedirectFailed] = useState(false);

  useEffect(
    () =>
      subscribe((next) => {
        noteSignedIn(next);
        // Whose boards show changes with whoever is here, before anything renders them.
        owners.arrived({
          owner: next.kind === "signedIn" ? next.uid : null,
          guestUid: next.kind === "guest" ? next.uid : null,
        });
        setAccount(next);
      }),
    [subscribe],
  );

  // A guest linked to Google keeps its uid, and Firebase tells its listeners
  // only of a new uid: the page asks who is here once the sign-in is done.
  const signInAndShow = useCallback(async () => {
    const outcome = await signIn();
    if (outcome.kind === "signedIn") {
      const next = current();
      noteSignedIn(next);
      owners.arrived({ owner: next.kind === "signedIn" ? next.uid : null, guestUid: null });
      setAccount(next);
    }
    return outcome;
  }, [signIn, current]);

  // A sign-in that left through a redirect lands back here.
  useEffect(() => {
    void complete().then((outcome) => {
      if (kindOf(outcome) === "failed") setRedirectFailed(true);
      if (kindOf(outcome) === "signedIn") {
        const next = current();
        noteSignedIn(next);
        owners.arrived({ owner: next.kind === "signedIn" ? next.uid : null, guestUid: null });
        setAccount(next);
      }
    });
  }, [complete, current]);

  const session = useMemo(
    () => ({
      account:
        account?.kind === "signedIn" && shownFace !== undefined
          ? { ...account, photoUrl: shownFace }
          : account,
      signIn: signInAndShow,
      signOut,
      // Firebase fires nothing for a new name or face either: the next visit's
      // first moment draws what is noted here, so it is noted now.
      refresh: () => {
        const next = current();
        noteSignedIn(next);
        setAccount(next);
      },
    }),
    [account, shownFace, signInAndShow, signOut, current],
  );
  return (
    <SessionContext.Provider value={session}>
      <ShowFaceContext.Provider value={showFace}>
        <RedirectFailedContext.Provider value={redirectFailed}>
          {children}
        </RedirectFailedContext.Provider>
      </ShowFaceContext.Provider>
    </SessionContext.Provider>
  );
}
