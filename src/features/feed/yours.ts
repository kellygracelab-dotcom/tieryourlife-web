import { isOwnList, type ListSummary } from "../../api/types";
import { useSession } from "../../app/session";
import type { Yours } from "../../ui/ListCard";

/** Whose face a card wears when the list is the signed-in person's own; null on anybody else's. */
export function useYours(): (list: ListSummary) => Yours | null {
  const { account } = useSession();
  return (list) =>
    account?.kind === "signedIn" && isOwnList(list, account.uid)
      ? { uid: account.uid, name: account.displayName, photoUrl: account.photoUrl }
      : null;
}
