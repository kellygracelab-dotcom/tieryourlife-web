import { useEffect, useMemo, useState, type ReactNode } from "react";
import { claimKeptRankings } from "../features/ranking/claim";
import { currentAccount, subscribeToAccount, type Account } from "../lib/account";
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
import { SessionContext, ShowFaceContext } from "./session";

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

  useEffect(() => subscribe(setAccount), [subscribe]);

  // A sign-in that left through a redirect lands back here.
  useEffect(() => {
    void complete();
  }, [complete]);

  const session = useMemo(
    () => ({
      account:
        account?.kind === "signedIn" && shownFace !== undefined
          ? { ...account, photoUrl: shownFace }
          : account,
      signIn,
      signOut,
      refresh: () => setAccount(current()),
    }),
    [account, shownFace, signIn, signOut, current],
  );
  return (
    <SessionContext.Provider value={session}>
      <ShowFaceContext.Provider value={showFace}>{children}</ShowFaceContext.Provider>
    </SessionContext.Provider>
  );
}
