import { MediaImage } from "../../ui/MediaImage";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Candidate, Moderator } from "../../api/admin";
import { errorOf } from "../../api/errors";
import { useSession } from "../../app/session";
import { appointModerator, findCandidates, loadModerators, removeModerator } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { currentLocale, fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { PaneLoading } from "./PaneLoading";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { useModal } from "../../ui/useModal";
import { initialOf } from "../../lib/initial";

export interface ModeratorsDeps {
  load: () => Promise<{ moderators: Moderator[] }>;
  find: (q: string) => Promise<{ people: Candidate[] }>;
  appoint: (who: { uid: string; name: string; photoUrl: string | null }) => Promise<void>;
  remove: (uid: string) => Promise<void>;
}

const moderatorsDeps: ModeratorsDeps = {
  load: loadModerators,
  find: findCandidates,
  appoint: appointModerator,
  remove: removeModerator,
};

/** How long the field waits after the last key before it asks for names. */
export const FIND_AFTER_MS = 300;

function Face({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  return photoUrl !== null ? (
    <MediaImage className="admin-people__face" src={photoUrl} alt="" loading="lazy" />
  ) : (
    <span className="admin-people__face admin-people__face--initial" aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

type Asking = { kind: "appoint"; who: Candidate } | { kind: "remove"; who: Moderator } | null;

/**
 * Appoint or Remove, asked over the page: the keyboard goes in, Escape and a
 * click outside are Cancel, and the focus goes back to the button that asked.
 */
function AskDialog({
  asking,
  failed,
  busy,
  onCancel,
  onConfirm,
}: {
  asking: NonNullable<Asking>;
  failed: boolean;
  /** The answer is on its way: a second press would ask twice. */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onCancel);
  return createPortal(
    <div className="scrim" onClick={onCancel}>
      <div
        ref={box}
        className="dialog dialog--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-ask-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="admin-ask-title" className="dialog__title">
          {fill(asking.kind === "appoint" ? strings.admin.appointAsk : strings.admin.removeAsk, {
            name: asking.who.name,
          })}
        </h2>
        {failed && (
          <p className="admin__bar" role="alert">
            {strings.admin.actionFailed}
          </p>
        )}
        <div className="dialog__actions">
          <Button onClick={onCancel}>{strings.admin.cancel}</Button>
          <Button
            variant={asking.kind === "appoint" ? "filled" : "danger"}
            disabled={busy}
            onClick={onConfirm}
          >
            {asking.kind === "appoint" ? strings.admin.appoint : strings.admin.remove}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Who besides the owner decides reports and proposals. Only the owner sees
 * this pane, and only the owner's word appoints: the backend refuses anybody
 * else, so a moderator cannot make moderators.
 */
export function ModeratorsPane({ deps = moderatorsDeps }: { deps?: ModeratorsDeps }) {
  const [round, setRound] = useState(0);
  const load = useCallback(() => deps.load(), [deps]);
  const { state } = useResource(String(round), load);
  const { account } = useSession();
  const [query, setQuery] = useState("");
  // What the lookup answered, and for which words: an answer to older words is not shown.
  const [found, setFound] = useState<{ words: string; people: Candidate[] | null } | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    const words = query.trim();
    if (words.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      deps.find(words).then(
        (answer) => current && setFound({ words, people: answer.people }),
        (reason: unknown) => {
          // A backend without the lookup yet finds nobody; any other failure is said.
          if (current) setFound({ words, people: errorOf(reason).kind === "notFound" ? [] : null });
        },
      );
    }, FIND_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, deps]);

  const settle = (work: Promise<void>, text: string, undo?: () => Promise<void>) => {
    setFailed(false);
    setBusy(true);
    work.then(
      () => {
        setBusy(false);
        // The person found is appointed: the search has done its work.
        if (asking?.kind === "appoint") {
          setQuery("");
          setFound(null);
        }
        setAsking(null);
        setRound((n) => n + 1);
        setNotice({
          text,
          ...(undo === undefined
            ? {}
            : {
                action: {
                  text: strings.sections.undo,
                  onClick: () =>
                    void undo().then(
                      () => setRound((n) => n + 1),
                      () => setNotice({ text: strings.admin.actionFailed }),
                    ),
                },
              }),
        });
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  const moderators = state.status === "ready" ? state.value.moderators : [];
  // The owner is no candidate, and a moderator already is one: neither is offered.
  const me = account?.kind === "signedIn" ? account.uid : null;
  const words = query.trim();
  const answered = found !== null && found.words === words ? found.people : undefined;
  const candidates = (answered ?? []).filter(
    (person) => person.uid !== me && !moderators.some((one) => one.uid === person.uid),
  );
  return (
    <section className="admin-pane" aria-labelledby="admin-moderators">
      <header className="admin-pane__head">
        <h2 id="admin-moderators" className="admin-pane__title">
          {strings.admin.moderators}
        </h2>
        <p className="admin-pane__count">{plural(strings.admin.people, moderators.length)}</p>
      </header>
      <label className="field admin-people__find">
        <span className="visually-hidden">{strings.admin.findPerson}</span>
        <input
          type="search"
          placeholder={strings.admin.findPerson}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {words.length >= 2 && answered === null && (
        <p className="admin__bar" role="alert">
          {strings.admin.failed}
        </p>
      )}
      {words.length >= 2 && answered != null && candidates.length === 0 && (
        <p className="admin-pane__note" role="status">
          {fill(strings.admin.nobodyFound, { q: words })}
        </p>
      )}
      {words.length >= 2 && candidates.length > 0 && (
        <ul className="admin-people admin-people--found">
          {candidates.map((person) => (
            <li key={person.uid} className="admin-people__row">
              <Face photoUrl={person.photoUrl} name={person.name} />
              <span className="admin-people__text">
                <span className="admin-people__name">{person.name}</span>
                <span className="admin-people__meta">{person.email}</span>
              </span>
              <Button variant="tonal" onClick={() => setAsking({ kind: "appoint", who: person })}>
                {strings.admin.appoint}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {asking !== null && (
        <AskDialog
          asking={asking}
          failed={failed}
          busy={busy}
          onCancel={() => {
            setAsking(null);
            setFailed(false);
          }}
          onConfirm={() => {
            const who = asking.who;
            if (asking.kind === "appoint") {
              settle(deps.appoint(who), fill(strings.admin.appointed, { name: who.name }));
            } else {
              settle(deps.remove(who.uid), fill(strings.admin.removed, { name: who.name }), () =>
                deps.appoint(who),
              );
            }
          }}
        />
      )}
      {state.status === "loading" ? (
        <PaneLoading />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{strings.admin.failed}</p>
          <Button variant="tonal" icon="refresh" onClick={() => setRound((n) => n + 1)}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : (
        <ul className="admin-people">
          <li className="admin-people__row">
            <span className="admin-people__text">
              <span className="admin-people__name">{strings.admin.you}</span>
            </span>
            <span className="admin-people__owner">{strings.admin.owner}</span>
          </li>
          {moderators.map((person) => (
            <li key={person.uid} className="admin-people__row">
              <Face photoUrl={person.photoUrl} name={person.name} />
              <span className="admin-people__text">
                <span className="admin-people__name">{person.name || strings.profile.someone}</span>
                <span className="admin-people__meta">
                  {[
                    ...(person.email ? [person.email] : []),
                    fill(strings.admin.since, {
                      date: new Intl.DateTimeFormat(currentLocale()).format(person.appointedAt),
                    }),
                  ].join(" · ")}
                </span>
              </span>
              <Button variant="danger" onClick={() => setAsking({ kind: "remove", who: person })}>
                {strings.admin.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
