import { useCallback, useState } from "react";
import type { AdminRole, AdminSections, TopicChanges, TopicDraft } from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { Topic } from "../../api/sections";
import {
  createTopic,
  deleteTopic,
  editTopic,
  loadAdminSections,
  loadAllTopics,
} from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { PaneLoading } from "./PaneLoading";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import type { EditorDeps } from "../sections/editorDeps";
import { builtInSection, sectionOf, sectionStyle, topicStyle } from "../sections/model";
import { fileUnderChoices } from "../sections/proposal";
import { TopicArt } from "../sections/TopicArt";
import { useSections } from "../sections/useSections";
import { TopicEditor } from "./TopicEditor";

export { TOPIC_NAME_MAX } from "./TopicEditor";

export interface TopicsDeps {
  /** Every section as staff read them, hidden ones too: their topics are still staff's to keep. */
  sections: () => Promise<AdminSections>;
  load: (section: string) => Promise<{ topics: Topic[] }>;
  create: (draft: TopicDraft) => Promise<Topic>;
  /** Its name, its picture, or both: PATCH, the one call that takes a picture. */
  edit: (id: string, changes: TopicChanges) => Promise<Topic>;
  remove: (id: string) => Promise<void>;
}

const topicsDeps: TopicsDeps = {
  sections: loadAdminSections,
  load: loadAllTopics,
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
  // The public sections leave the hidden ones out; staff's own answer has them,
  // and replaces the public ones once it comes.
  const loadSections = useCallback(() => deps.sections(), [deps]);
  const everyRead = useResource("admin-topics-sections", loadSections);
  const every = everyRead.state.status === "ready" ? everyRead.state.value.sections : null;
  const approved =
    every === null
      ? sections.filter((one) => one.status === "approved")
      : fileUnderChoices(every.map((one) => sectionOf(one)));
  const [section, setSection] = useState(approved[0]?.id ?? "anime");
  const [round, setRound] = useState(0);
  const load = useCallback(() => deps.load(section), [deps, section]);
  const { state } = useResource(`${section}:${round}`, load);
  const [editing, setEditing] = useState<Editing>(null);
  // A delete cannot be undone and takes the topic's followers with it: it is asked first.
  const [deleting, setDeleting] = useState<Topic | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const look = approved.find((one) => one.id === section) ?? builtInSection("other");
  // The backend takes a new topic only in an open section; a hidden one's are renamed or deleted.
  const hiddenHere = every?.some((one) => one.id === section && one.hidden === true) === true;

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
        setDeleting(null);
        saved(fill(strings.admin.topicDeleted, { name: topic.name }));
      },
      (reason: unknown) => {
        setBusy(false);
        // 409 NOT_EMPTY, the one conflict a delete meets: a list came into the
        // topic since its row was drawn. Asking again never helps; the row is
        // read again, and loses its Delete.
        if (errorOf(reason).kind === "conflict") {
          setDeleting(null);
          saved(fill(strings.admin.topicNotEmpty, { name: topic.name }));
        } else setFailed(true);
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
        {!hiddenHere && (
          <Button variant="tonal" icon="add" onClick={() => setEditing({ kind: "create" })}>
            {strings.admin.newTopic}
          </Button>
        )}
      </header>
      {hiddenHere && <p className="admin-pane__note">{strings.admin.hiddenLine}</p>}
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
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    setFailed(false);
                    setDeleting(topic);
                  }}
                >
                  {strings.admin.delete}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting !== null && (
        <ConfirmDialog
          narrow
          title={fill(strings.admin.deleteTopicAsk, { name: deleting.name })}
          body={strings.admin.deleteTopicBody}
          confirmLabel={strings.admin.delete}
          cancelLabel={strings.admin.cancel}
          busy={busy}
          trouble={
            failed && (
              <p className="dialog__bar" role="alert">
                {strings.admin.actionFailed}
              </p>
            )
          }
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
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
