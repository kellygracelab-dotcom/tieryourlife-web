import type { User } from "firebase/auth";
import type { AccountAction } from "../api/client";
import { getFirebaseAuth } from "./firebase";

type Principal = Pick<User, "uid" | "isAnonymous" | "getIdToken">;

/** The click, its retry and its receipt belong to this Firebase sign-in. */
export function captureAccountAction(
  uid: string,
  auth: { readonly currentUser: Principal | null } = getFirebaseAuth(),
): AccountAction | null {
  const user = auth.currentUser;
  if (!user || user.isAnonymous || user.uid !== uid) return null;
  return {
    uid,
    isCurrent: () => auth.currentUser === user && user.uid === uid && !user.isAnonymous,
    idToken: (forceRefresh) => user.getIdToken(forceRefresh),
  };
}
