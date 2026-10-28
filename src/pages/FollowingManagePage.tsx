import { useCallback, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router";
import type { Following } from "../api/community";
import type { Topic } from "../api/sections";
import { useSession } from "../app/session";
import { FollowButton } from "../features/community/FollowButton";
import {
  builtInSection,
  FOLLOWING_PATH,
  OTHER,
  sectionPath,
  sectionStyle,
  topicPath,
  topicStyle,
  type Section,
} from "../features/sections/model";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import {
  followAuthor,
  followTopic,
  loadFollowing,
  unfollowAuthor,
  unfollowTopic,
} from "../lib/api";
import { isEditorialAuthor } from "../lib/editorial";
import { useResource } from "../lib/useResource";
import { fill, plural, strings } from "../strings";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./FollowingManagePage.css";

export interface ManageDeps {
  load: () => Promise<Following>;
  followTopic: (id: string) => Promise<unknown>;
  unfollowTopic: (id: string) => Promise<unknown>;
  followAuthor: (uid: string) => Promise<unknown>;
  unfollowAuthor: (uid: string) => Promise<unknown>;
}

const manageDeps: ManageDeps = {
  load: loadFollowing,
  followTopic,
  unfollowTopic,
  followAuthor,
  unfollowAuthor,
};

interface FollowingManagePageProps {
  deps?: ManageDeps;
  store?: SectionsStore;
}

function Row({
  to,
  leading,
  headline,
  supporting,
  following,
  onToggle,
}: {
  to: string;
  leading: ReactNode;
  headline: string;
  supporting: string;
  following: boolean | null;
  onToggle: (() => void) | null;
}) {
  return (
    <li className="manage-row">
      <Link className="manage-row__main" to={to}>
        {leading}
        <span className="manage-row__text">
          <span className="manage-row__headline">{headline}</span>
          <span className="manage-row__supporting">{supporting}</span>
        </span>
      </Link>
      {onToggle !== null && <FollowButton following={following} size="card" onClick={onToggle} />}
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="manage-group">
      <h2 className="manage-group__title">
        {fill(strings.sections.group, { name: title, n: count })}
      </h2>
      <ul className="manage-group__rows">{children}</ul>
    </section>
  );
}

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

/**
 * Everything one follows, in three groups, each with its button: unfollowing
 * is one press with an Undo, and the row stays until the page is left, so a
 * slip is put right where it happened.
 */
export function FollowingManagePage({
  deps = manageDeps,
  store = sectionsStore,
}: FollowingManagePageProps) {
  const { account } = useSession();
  const { sections } = useSections(store);
  const uid = account?.kind === "signedIn" ? account.uid : "";
  const load = useCallback(() => deps.load(), [deps]);
  const followed = useResource(uid, load);
  // What this visit changed, by key; a row keeps its place either way.
  const [changed, setChanged] = useState<ReadonlyMap<string, boolean>>(new Map());
  // The sections followed when the page opened stay listed after an unfollow.
  // A section unfollowed during this visit keeps its row, with Follow on it.
  const [keptSections, setKeptSections] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  if (account !== null && account.kind !== "signedIn") return <Navigate to="/" replace />;

  const isOn = (key: string, was: boolean) => changed.get(key) ?? was;
  const set = (key: string, on: boolean) => setChanged((before) => new Map(before).set(key, on));

  /** Turns one follow and offers the way back; a refusal puts it back as it was. */
  const toggle = (
    key: string,
    name: string,
    on: boolean,
    apply: (on: boolean) => Promise<unknown>,
  ) => {
    const next = !on;
    set(key, next);
    apply(next).catch(() => {
      set(key, on);
      setNotice({ text: strings.sections.followFailed });
    });
    if (!next) {
      setNotice({
        text: fill(strings.sections.unfollowed, { name }),
        action: {
          text: strings.sections.undo,
          onClick: () => {
            set(key, true);
            apply(true).catch(() => set(key, false));
          },
        },
      });
    }
  };

  const byId = new Map(sections.map((one) => [one.id, one]));
  const sectionOf = (id: string | null): Section => byId.get(id ?? OTHER) ?? builtInSection(OTHER);
  const sectionRows = sections.filter((one) => one.following || keptSections.has(one.id));
  const topics: Topic[] = followed.state.status === "ready" ? followed.state.value.topics : [];
  const people =
    followed.state.status === "ready"
      ? followed.state.value.authors.filter((person) => !isEditorialAuthor(person.uid))
      : [];

  return (
    <section className="manage">
      <header className="manage__head">
        <Link className="manage__back" to={FOLLOWING_PATH} aria-label={strings.sections.back}>
          <Icon name="arrow_back" />
        </Link>
        <h1 className="manage__title">{strings.sections.tabFollowing}</h1>
      </header>
      {followed.state.status === "loading" ? (
        <Skeleton height="72px" />
      ) : sectionRows.length + topics.length + people.length === 0 ? (
        <div className="following-empty">
          <p className="following-empty__title">{strings.sections.emptyTitle}</p>
          <p className="following-empty__body">{strings.sections.emptyBody}</p>
        </div>
      ) : (
        <>
          <Group title={strings.sections.sections} count={sectionRows.length}>
            {sectionRows.map((section) => (
              <Row
                key={section.id}
                to={sectionPath(section.id)}
                leading={
                  <span
                    className="manage-row__square"
                    style={sectionStyle(section)}
                    aria-hidden="true"
                  >
                    <Icon name={section.icon} />
                  </span>
                }
                headline={section.name}
                supporting={plural(strings.sections.followers, section.followerCount)}
                following={section.following}
                onToggle={() => {
                  setKeptSections((before) => new Set([...before, section.id]));
                  toggle(`s:${section.id}`, section.name, section.following, async (on) => {
                    if (!(await store.setFollowing(section.id, on))) throw new Error("refused");
                  });
                }}
              />
            ))}
          </Group>
          <Group title={strings.sections.topics} count={topics.length}>
            {topics.map((topic) => {
              const section = sectionOf(topic.section);
              const waiting = topic.status === "pending";
              const on = isOn(`t:${topic.id}`, true);
              return (
                <Row
                  key={topic.id}
                  to={topicPath(section.id, topic.id)}
                  leading={
                    <span
                      className={
                        waiting
                          ? "manage-row__square manage-row__square--waiting"
                          : "manage-row__square manage-row__topic"
                      }
                      style={topicStyle(section)}
                      aria-hidden="true"
                    >
                      <Icon name={waiting ? "schedule" : section.icon} />
                    </span>
                  }
                  headline={topic.name}
                  supporting={[
                    fill(strings.sections.reasonSection, { name: section.name }),
                    waiting
                      ? strings.sections.waiting
                      : plural(strings.sections.followers, topic.followerCount),
                  ].join(" · ")}
                  following={on}
                  onToggle={
                    waiting
                      ? null
                      : () =>
                          toggle(`t:${topic.id}`, topic.name, on, (next) =>
                            next ? deps.followTopic(topic.id) : deps.unfollowTopic(topic.id),
                          )
                  }
                />
              );
            })}
          </Group>
          <Group title={strings.sections.people} count={people.length}>
            {people.map((person) => {
              const name = person.name.trim() || strings.profile.someone;
              const on = isOn(`p:${person.uid}`, true);
              return (
                <Row
                  key={person.uid}
                  to={`/u/${encodeURIComponent(person.uid)}`}
                  leading={
                    person.photoUrl !== null ? (
                      <img
                        className="manage-row__face"
                        src={person.photoUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="manage-row__face manage-row__face--initial"
                        aria-hidden="true"
                      >
                        {initialOf(person.name)}
                      </span>
                    )
                  }
                  headline={name}
                  supporting=""
                  following={on}
                  onToggle={() =>
                    toggle(`p:${person.uid}`, name, on, (next) =>
                      next ? deps.followAuthor(person.uid) : deps.unfollowAuthor(person.uid),
                    )
                  }
                />
              );
            })}
          </Group>
        </>
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
