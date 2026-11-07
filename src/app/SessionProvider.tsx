import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { VisitContext, VisitMemory } from "./visitMemory";
import { onListChanged } from "../lib/listChanges";
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
  /** Hands this device's finished rankings to an account; see signInDeps.keep. */
  keep?: (uid: string) => Promise<unknown>;
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
  keep = signInDeps.keep,
}: SessionProviderProps) {
  const [account, setAccount] = useState<Account | null>(null);
  // A face chosen a moment ago and still on its way to Firebase.
  const reader = account?.kind === "signedIn" ? account.uid : null;
  const visit = useMemo(() => new VisitMemory(), [reader]);
  useEffect(() => onListChanged(() => visit.clear()), [visit]);
  const [shownFace, showFace] = useState<string | null | undefined>(undefined);
  const [redirectFailed, setRedirectFailed] = useState(false);
  // A claim that failed at sign-in (the network, the server) would otherwise
  // wait for the next sign-in, while /me already lists the ranking as the
  // account's and the server refuses to delete or change it. Each visit with
  // an account tries the ones still owed once; those handed over are skipped.
  const claimedFor = useRef<string | null>(null);

  useEffect(
    () =>
      subscribe((next) => {
        if (next.kind === "signedIn" && claimedFor.current !== next.uid) {
          claimedFor.current = next.uid;
          void keep(next.uid).catch(() => undefined);
        }
        noteSignedIn(next);
        // Whose boards show changes with whoever is here, before anything renders them.
        owners.arrived({
          owner: next.kind === "signedIn" ? next.uid : null,
          guestUid: next.kind === "guest" ? next.uid : null,
        });
        setAccount(next);
      }),
    [subscribe, keep],
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
    <VisitContext.Provider value={visit}>
      <SessionContext.Provider value={session}>
        <ShowFaceContext.Provider value={showFace}>
          <RedirectFailedContext.Provider value={redirectFailed}>
            {children}
          </RedirectFailedContext.Provider>
        </ShowFaceContext.Provider>
      </SessionContext.Provider>
    </VisitContext.Provider>
  );
}
