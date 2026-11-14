import { useEffect, useState } from "react";
import type { AccountAction } from "../../api/client";
import { captureAccountAction } from "../../lib/accountAction";
import { IN_APP_BROWSER } from "../../lib/inAppBrowser";
import { useBoardSync } from "./boardSync";
import { useSession } from "../../app/session";
import { localStorageStore } from "../../lib/storage";
import { strings } from "../../strings";
import { InAppNote } from "../../ui/InAppNote";

export const offerKey = (uid: string | null, listId: string) =>
  "tyl:ranking-offer:" + JSON.stringify([uid, listId]);

export function settleRankingOffer(uid: string | null, listId: string) {
  const key = offerKey(uid, listId);
  localStorageStore.write(key, "done");
  window.dispatchEvent(new CustomEvent("tyl:ranking-choice", { detail: key }));
}

interface OfferProps {
  listId: string;
  /** The moment for it: a game just put its result on the board, or every card has its place. */
  due: boolean;
  /** Decided already, on this device or another: shown in Rankings, or let be. */
  known?: boolean;
  /** Show in Rankings; true once the ranking is there. */
  share: (action: AccountAction) => Promise<boolean>;
  /** Told how it was answered: shown in Rankings, or not now. */
  onSettled?: (shown: boolean) => void;
}

/**
 * "Show others how you ranked it?" (Danylo, 14.11.2026): asked once about
 * somebody else's list, after a game and when every card is placed, with
 * Show in Rankings and Not now. A guest is offered Sign in to share.
 */
export function RankingOffer(props: OfferProps) {
  const { account } = useSession();
  const owner = account?.kind === "signedIn" ? account.uid : null;
  return account === null ? null : (
    <Offer
      key={offerKey(owner, props.listId)}
      {...props}
      uid={owner}
      signedIn={account.kind === "signedIn"}
    />
  );
}

function Offer({
  listId,
  due,
  share,
  signedIn,
  known = false,
  onSettled,
  uid,
}: OfferProps & { signedIn: boolean; uid: string | null }) {
  const { signIn } = useSession();
  const key = offerKey(uid, listId);
  const [state, setState] = useState<"waiting" | "open" | "closed">("waiting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sync = useBoardSync();
  // The account's boards still on their way may say it was answered on another device.
  const restoring =
    sync.signedIn && sync.backUp && sync.status === "syncing" && sync.lastSyncedAt === null;
  if (state === "waiting" && due && !restoring) {
    setState(!known && localStorageStore.read(key) === null ? "open" : "closed");
  }
  // Once: seen, it is not asked again, answered or not.
  useEffect(() => {
    if (state === "open" && localStorageStore.read(key) === null) {
      localStorageStore.write(key, "seen");
    }
  }, [state, key]);
  useEffect(() => {
    if (state !== "open") return;
    const decided = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setState("closed");
    };
    const synced = (event: StorageEvent) => {
      if (event.key === key && event.newValue === "done") setState("closed");
    };
    window.addEventListener("tyl:ranking-choice", decided);
    window.addEventListener("storage", synced);
    return () => {
      window.removeEventListener("tyl:ranking-choice", decided);
      window.removeEventListener("storage", synced);
    };
  }, [state, key]);
  if (state !== "open" || known) return null;

  const show = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!signedIn) {
        const outcome = await signIn();
        // In another app's browser the note above already says why it cannot work.
        if (outcome.kind === "failed" && outcome.code !== IN_APP_BROWSER) {
          setError(strings.nav.signInFailed);
        }
        return;
      }
      const action = uid === null ? null : captureAccountAction(uid);
      if (!action) return;
      if ((await share(action)) && action.isCurrent()) {
        onSettled?.(true);
        settleRankingOffer(uid, listId);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="ranking-offer" aria-label={strings.rankings.progressTitle}>
      <div role="status">
        <strong>{strings.rankings.progressTitle}</strong>
        {!signedIn && <InAppNote />}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="ranking-offer__actions">
        <button
          type="button"
          className="btn btn--tonal"
          disabled={busy}
          onClick={() => void show()}
        >
          {signedIn ? strings.rankings.progressShare : strings.rankings.progressSignIn}
        </button>
        <button
          type="button"
          className="btn btn--text"
          disabled={busy}
          onClick={() => {
            if (uid !== null && !captureAccountAction(uid)) return;
            onSettled?.(false);
            settleRankingOffer(uid, listId);
          }}
        >
          {strings.rankings.progressLater}
        </button>
      </div>
    </aside>
  );
}
