import { useCallback, useEffect, useState } from "react";
import type { Candidate, Moderator } from "../../api/admin";
import { errorOf } from "../../api/errors";
import { appointModerator, findCandidates, loadModerators, removeModerator } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";

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

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

function Face({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  return photoUrl !== null ? (
    <img className="admin-people__face" src={photoUrl} alt="" loading="lazy" />
  ) : (
    <span className="admin-people__face admin-people__face--initial" aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

type Asking = { kind: "appoint"; who: Candidate } | { kind: "remove"; who: Moderator } | null;

/**
 * Who besides the owner decides reports and proposals. Only the owner sees
 * this pane, and only the owner's word appoints: the backend refuses anybody
 * else, so a moderator cannot make moderators.
 */
export function ModeratorsPane({ deps = moderatorsDeps }: { deps?: ModeratorsDeps }) {
  const [round, setRound] = useState(0);
  const load = useCallback(() => deps.load(), [deps]);
  const { state } = useResource(String(round), load);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Candidate[]>([]);
  const [asking, setAsking] = useState<Asking>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    const words = query.trim();
    if (words.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      deps.find(words).then(
        (answer) => current && setFound(answer.people),
        (reason: unknown) => {
          // A backend without the lookup yet finds nobody.
          if (current && errorOf(reason).kind === "notFound") setFound([]);
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
    work.then(
      () => {
        setAsking(null);
        setRound((n) => n + 1);
        setNotice({
          text,
          ...(undo === undefined
            ? {}
            : {
                action: {
                  text: strings.sections.undo,
                  onClick: () => void undo().then(() => setRound((n) => n + 1)),
                },
              }),
        });
      },
      () => setFailed(true),
    );
  };

  const moderators = state.status === "ready" ? state.value.moderators : [];
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
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length < 2) setFound([]);
          }}
        />
      </label>
      {found.length > 0 && asking === null && (
        <ul className="admin-people admin-people--found">
          {found.map((person) => (
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
        <div className="admin-confirm" role="group" aria-label={strings.admin.moderators}>
          <p>
            {fill(asking.kind === "appoint" ? strings.admin.appointAsk : strings.admin.removeAsk, {
              name: asking.who.name,
            })}
          </p>
          <Button onClick={() => setAsking(null)}>{strings.admin.cancel}</Button>
          <Button
            variant={asking.kind === "appoint" ? "filled" : "danger"}
            onClick={() => {
              const who = asking.who;
              if (asking.kind === "appoint") {
                settle(deps.appoint(who), fill(strings.admin.appointed, { name: who.name }));
                setQuery("");
                setFound([]);
              } else {
                settle(deps.remove(who.uid), fill(strings.admin.removed, { name: who.name }), () =>
                  deps.appoint(who),
                );
              }
            }}
          >
            {asking.kind === "appoint" ? strings.admin.appoint : strings.admin.remove}
          </Button>
        </div>
      )}
      {failed && (
        <p className="admin__bar" role="alert">
          {strings.admin.actionFailed}
        </p>
      )}
      {state.status === "loading" ? (
        <Skeleton height="128px" />
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
                      date: new Date(person.appointedAt).toLocaleDateString(),
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
