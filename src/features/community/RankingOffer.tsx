import { useEffect, useState } from "react";
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
  keep: () => boolean;
  share: () => Promise<boolean>;
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
  uid,
}: OfferProps & { signedIn: boolean; uid: string | null }) {
  const { signIn } = useSession();
  const key = offerKey(uid, listId);
  const [state, setState] = useState<"waiting" | "open" | "closed">("waiting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = total > 0 && placed * 10 > total * 3;
  useEffect(() => {
    if (state !== "waiting" || !eligible || localStorageStore.read(key) !== null) return;
    localStorageStore.write(key, "seen");
    setState("open");
  }, [state, eligible, key, uid, listId]);
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
  if (state !== "open" || !eligible) return null;

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
      if (!keep()) {
        setError(strings.nav.storageRefused);
        return;
      }
      if (!publish || (await share())) settleRankingOffer(uid, listId);
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
          onClick={() => settleRankingOffer(uid, listId)}
        >
          {strings.rankings.progressLater}
        </button>
      </div>
    </aside>
  );
}
