import { createContext, useContext } from "react";
import type { Account } from "../lib/account";
import type { SignInOutcome } from "../lib/signIn";

export interface Session {
  /** null until Firebase has said who is here. */
  account: Account | null;
  signIn: () => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
}

export const GUEST: Account = { kind: "guest", uid: null };

// Pages rendered without a provider (tests, mostly) see a guest who cannot sign in.
export const SessionContext = createContext<Session>({
  account: GUEST,
  signIn: () => Promise.resolve({ kind: "failed", code: "no-session" }),
  signOut: () => Promise.resolve(),
});

export const useSession = (): Session => useContext(SessionContext);
