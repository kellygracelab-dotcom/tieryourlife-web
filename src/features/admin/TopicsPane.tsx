import { useCallback, useState } from "react";
import type { AdminRole, TopicChanges, TopicDraft } from "../../api/admin";
import type { Topic } from "../../api/sections";
import { createTopic, deleteTopic, editTopic, loadTopics } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { PaneLoading } from "./PaneLoading";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import type { EditorDeps } from "../sections/editorDeps";
import { builtInSection, sectionStyle, topicStyle } from "../sections/model";
import { TopicArt } from "../sections/TopicArt";
import { useSections } from "../sections/useSections";
import { TopicEditor } from "./TopicEditor";

export { TOPIC_NAME_MAX } from "./TopicEditor";

export interface TopicsDeps {
  load: (section: string) => Promise<{ topics: Topic[] }>;
  create: (draft: TopicDraft) => Promise<Topic>;
  /** Its name, its picture, or both: PATCH, the one call that takes a picture. */
  edit: (id: string, changes: TopicChanges) => Promise<Topic>;
  remove: (id: string) => Promise<void>;
}

const topicsDeps: TopicsDeps = {
  load: (section) => loadTopics(section, 50),
  create: createTopic,
  edit: editTopic,
  remove: deleteTopic,
};

/** The dialog: a new topic, or one of them. */
type Editing = { kind: "create" } | { kind: "edit"; topic: Topic } | null;

/**
 * The topics inside one section, most followed first, and the way to make
 * one without waiting for anybody to propose it, picture and all. Renaming
 * keeps every list under it; only an empty topic can be deleted, and only by
 * the owner.
 */
export function TopicsPane({
  adminRole: role,
  deps = topicsDeps,
  editor,
}: {
  adminRole: AdminRole;
  deps?: TopicsDeps;
  /** What the picture leans on: the crop and the upload. */
  editor?: EditorDeps;
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
  const look = approved.find((one) => one.id === section) ?? builtInSection("other");

  const saved = (text: string) => {
    setEditing(null);
    setNotice({ text });
    setRound((n) => n + 1);
  };

  const remove = (topic: Topic) => {
    setBusy(true);
    setFailed(false);
    deps.remove(topic.id).then(
      () => {
        setBusy(false);
        saved(fill(strings.admin.topicDeleted, { name: topic.name }));
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  const topics =
    state.status === "ready"
      ? state.value.topics
          .filter((one) => one.status === "approved")
          .sort((a, b) => b.followerCount - a.followerCount)
      : [];

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
        <Button variant="tonal" icon="add" onClick={() => setEditing({ kind: "create" })}>
          {strings.admin.newTopic}
        </Button>
      </header>
      {failed && (
        <p className="admin__bar" role="alert">
          {strings.admin.actionFailed}
        </p>
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
      ) : topics.length === 0 ? (
        <p className="admin-pane__note">{strings.admin.noTopics}</p>
      ) : (
        <ul className="admin-topics">
          {topics.map((topic) => (
            <li key={topic.id} className="admin-topics__row">
              <span
                className="admin-topics__square"
                style={{ ...sectionStyle(look), ...topicStyle(look) }}
                aria-hidden="true"
              >
                <TopicArt topic={topic} icon={look.icon} />
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
              <Button icon="edit" onClick={() => setEditing({ kind: "edit", topic })}>
                {strings.admin.edit}
              </Button>
              {role === "owner" && topic.listCount === 0 && (
                <Button variant="danger" disabled={busy} onClick={() => remove(topic)}>
                  {strings.admin.delete}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing?.kind === "create" && (
        <TopicEditor
          mode="create"
          section={look}
          send={deps.create}
          deps={editor}
          onClose={() => setEditing(null)}
          onDone={(made) => saved(fill(strings.admin.topicCreated, { name: made.name }))}
        />
      )}
      {editing?.kind === "edit" && (
        <TopicEditor
          mode="edit"
          topic={editing.topic}
          section={look}
          send={(changes) => deps.edit(editing.topic.id, changes)}
          deps={editor}
          onClose={() => setEditing(null)}
          onDone={(made) => saved(fill(strings.admin.topicSaved, { name: made.name }))}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
