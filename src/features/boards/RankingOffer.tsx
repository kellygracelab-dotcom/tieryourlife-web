import { useEffect, useState } from "react";
import type { AccountAction } from "../../api/client";
import { captureAccountAction } from "../../lib/accountAction";
import { useBoardSync } from "./boardSync";
import type { RankingChoice } from "../../api/boards";
import { useSession } from "../../app/session";
import { localStorageStore } from "../../lib/storage";
import { fill, strings } from "../../strings";

export const offerKey = (uid: string | null, listId: string) =>
  "tyl:ranking-offer:" + JSON.stringify([uid, listId]);

export function settleRankingOffer(uid: string | null, listId: string) {
  const key = offerKey(uid, listId);
  localStorageStore.write(key, "done");
  window.dispatchEvent(new CustomEvent("tyl:ranking-choice", { detail: key }));
}

interface OfferProps {
  listId: string;
  placed: number;
  total: number;
  keep: (action?: AccountAction) => string | null;
  known?: boolean;
  remember: (choice: RankingChoice, boardUid?: string) => void;
  share: (action: AccountAction) => Promise<boolean>;
}

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
  placed,
  total,
  keep,
  share,
  signedIn,
  known = false,
  remember,
  uid,
}: OfferProps & { signedIn: boolean; uid: string | null }) {
  const { signIn } = useSession();
  const key = offerKey(uid, listId);
  const [state, setState] = useState<"waiting" | "open" | "closed">("waiting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sync = useBoardSync();
  const restoring =
    sync.signedIn && sync.backUp && sync.status === "syncing" && sync.lastSyncedAt === null;
  const eligible = !restoring && total > 0 && placed * 10 > total * 3;
  if (state === "waiting" && eligible) {
    setState(!known && localStorageStore.read(key) === null ? "open" : "closed");
  }
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
  if (state !== "open" || !eligible || known) return null;

  const choose = async (publish: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (publish && !signedIn) {
        const outcome = await signIn();
        if (outcome.kind === "failed") setError(strings.nav.signInFailed);
        return;
      }
      const action = uid === null ? null : captureAccountAction(uid);
      if (uid !== null && !action) return;
      const kept = keep(action ?? undefined);
      if (kept === null) {
        setError(strings.nav.storageRefused);
        return;
      }
      if (!publish || (action && (await share(action)) && action.isCurrent())) {
        remember(publish ? "ranking" : "private", kept);
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
        <p>
          {fill(strings.rankings.progressCount, { placed, total })}{" "}
          {signedIn ? strings.rankings.progressPrivate : strings.rankings.progressGuest}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="ranking-offer__actions">
        <button
          type="button"
          className="btn btn--tonal"
          disabled={busy}
          onClick={() => void choose(true)}
        >
          {signedIn ? strings.rankings.progressShare : strings.rankings.progressSignIn}
        </button>
        <button
          type="button"
          className="btn btn--text"
          disabled={busy}
          onClick={() => void choose(false)}
        >
          {strings.rankings.progressKeep}
        </button>
        <button
          type="button"
          className="btn btn--text"
          disabled={busy}
          onClick={() => {
            if (uid !== null && !captureAccountAction(uid)) return;
            remember("offered");
            settleRankingOffer(uid, listId);
          }}
        >
          {strings.rankings.progressLater}
        </button>
      </div>
    </aside>
  );
}
