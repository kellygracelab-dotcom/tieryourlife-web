import { useEffect, useMemo, useState, type ReactNode } from "react";
import { currentAccount, subscribeToAccount, type Account } from "../lib/account";
import { signOutToGuest } from "../lib/firebase";
import { completeSignIn, signInWithGoogle, type SignInOutcome } from "../lib/signIn";
import { SessionContext } from "./session";

interface SessionProviderProps {
  children: ReactNode;
  subscribe?: (listener: (account: Account) => void) => () => void;
  signIn?: () => Promise<SignInOutcome>;
  signOut?: () => Promise<void>;
  complete?: () => Promise<unknown>;
  current?: () => Account;
}

const defaultSignIn = () => signInWithGoogle();
const defaultComplete = () => completeSignIn();

export function SessionProvider({
  children,
  subscribe = subscribeToAccount,
  signIn = defaultSignIn,
  signOut = signOutToGuest,
  complete = defaultComplete,
  current = currentAccount,
}: SessionProviderProps) {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => subscribe(setAccount), [subscribe]);

  // A sign-in that left through a redirect lands back here.
  useEffect(() => {
    void complete();
  }, [complete]);

  const session = useMemo(
    () => ({ account, signIn, signOut, refresh: () => setAccount(current()) }),
    [account, signIn, signOut, current],
  );
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
