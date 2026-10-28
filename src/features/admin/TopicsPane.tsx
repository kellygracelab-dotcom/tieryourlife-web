import { useCallback, useState } from "react";
import type { AdminRole } from "../../api/admin";
import type { Topic } from "../../api/sections";
import { createTopic, decideTopic, deleteTopic, loadTopics } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { sectionStyle, topicStyle } from "../sections/model";
import { useSections } from "../sections/useSections";

export const TOPIC_NAME_MAX = 24;

export interface TopicsDeps {
  load: (section: string) => Promise<{ topics: Topic[] }>;
  create: (draft: { name: string; section: string }) => Promise<Topic>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const topicsDeps: TopicsDeps = {
  load: (section) => loadTopics(section, 50),
  create: createTopic,
  rename: (id, name) => decideTopic(id, { action: "rename", name }),
  remove: deleteTopic,
};

type Editing = { id: string | null; name: string } | null;

/**
 * The topics inside one section, most followed first, and the way to make
 * one without waiting for anybody to propose it. Renaming keeps every list
 * under it; only an empty topic can be deleted, and only by the owner.
 */
export function TopicsPane({
  adminRole: role,
  deps = topicsDeps,
}: {
  adminRole: AdminRole;
  deps?: TopicsDeps;
}) {
  const { sections } = useSections();
  const approved = sections.filter((one) => one.status === "approved");
  const [section, setSection] = useState(approved[0]?.id ?? "anime");
  const [round, setRound] = useState(0);
  const load = useCallback(() => deps.load(section), [deps, section]);
  const { state } = useResource(`${section}:${round}`, load);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const look = approved.find((one) => one.id === section);

  const settle = (work: Promise<unknown>, text: string) => {
    setBusy(true);
    setFailed(false);
    work.then(
      () => {
        setBusy(false);
        setEditing(null);
        setNotice({ text });
        setRound((n) => n + 1);
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  const save = () => {
    if (editing === null) return;
    const name = editing.name.trim();
    if (name === "") return;
    settle(
      editing.id === null ? deps.create({ name, section }) : deps.rename(editing.id, name),
      fill(editing.id === null ? strings.admin.topicCreated : strings.admin.topicRenamed, { name }),
    );
  };

  const topics =
    state.status === "ready"
      ? state.value.topics
          .filter((one) => one.status === "approved")
          .sort((a, b) => b.followerCount - a.followerCount)
      : [];

  const form = editing !== null && (
    <form
      className="topic-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="field">
        <span className="field__label">{strings.admin.topicName}</span>
        <input
          autoFocus
          maxLength={TOPIC_NAME_MAX}
          value={editing.name}
          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
        />
      </label>
      <span className="field__counter">{`${editing.name.length}/${TOPIC_NAME_MAX}`}</span>
      <div className="proposal__actions">
        <Button onClick={() => setEditing(null)}>{strings.admin.cancel}</Button>
        <Button variant="filled" type="submit" disabled={busy || editing.name.trim() === ""}>
          {editing.id === null ? strings.admin.create : strings.admin.save}
        </Button>
      </div>
    </form>
  );

  return (
    <section className="admin-pane" aria-labelledby="admin-topics">
      <header className="admin-pane__head">
        <h2 id="admin-topics" className="admin-pane__title">
          {strings.admin.topics}
        </h2>
        <label className="admin-pane__select">
          <span className="visually-hidden">{strings.admin.inSection}</span>
          <select
            value={section}
            onChange={(event) => {
              setSection(event.target.value);
              setEditing(null);
            }}
          >
            {approved.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="tonal" icon="add" onClick={() => setEditing({ id: null, name: "" })}>
          {strings.admin.newTopic}
        </Button>
      </header>
      {failed && (
        <p className="admin__bar" role="alert">
          {strings.admin.actionFailed}
        </p>
      )}
      {editing?.id === null && form}
      {state.status === "loading" ? (
        <Skeleton height="168px" />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{strings.admin.failed}</p>
          <Button variant="tonal" icon="refresh" onClick={() => setRound((n) => n + 1)}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : topics.length === 0 ? (
        <p className="admin-pane__note">{strings.admin.noTopics}</p>
      ) : (
        <ul className="admin-topics">
          {topics.map((topic) => (
            <li key={topic.id} className="admin-topics__row">
              <span
                className="admin-topics__square"
                style={
                  look === undefined ? undefined : { ...sectionStyle(look), ...topicStyle(look) }
                }
                aria-hidden="true"
              >
                <Icon name={look?.icon ?? "label"} />
              </span>
              <span className="admin-topics__text">
                <span className="admin-topics__name">{topic.name}</span>
                <span className="admin-topics__meta">
                  {[
                    plural(strings.sections.lists, topic.listCount),
                    plural(strings.sections.followers, topic.followerCount),
                  ].join(" · ")}
                </span>
              </span>
              <Button icon="edit" onClick={() => setEditing({ id: topic.id, name: topic.name })}>
                {strings.admin.rename}
              </Button>
              {role === "owner" && topic.listCount === 0 && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    settle(
                      deps.remove(topic.id),
                      fill(strings.admin.topicDeleted, { name: topic.name }),
                    )
                  }
                >
                  {strings.admin.delete}
                </Button>
              )}
              {editing?.id === topic.id && form}
            </li>
          ))}
        </ul>
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
