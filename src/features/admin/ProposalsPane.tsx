import { useCallback, useState } from "react";
import type { AdminRole, PendingTopic, ProposedSection, TopicDecision } from "../../api/admin";
import { errorOf } from "../../api/errors";
import {
  approveSection,
  declineSection,
  decideTopic,
  loadSectionQueue,
  loadTopicQueue,
  mergeSection,
} from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { sectionOf, sectionStyle, topicStyle, type Section } from "../sections/model";
import type { EditorDeps } from "../sections/editorDeps";
import { SectionEditor } from "../sections/SectionEditor";
import { useSections } from "../sections/useSections";
import { agoText } from "../moderation/queue";
import { sectionWrites, type SectionWrites } from "./sectionWrites";

export interface ProposalsDeps {
  sections: () => Promise<{ sections: ProposedSection[] }>;
  topics: () => Promise<{ topics: PendingTopic[] }>;
  approveSection: (id: string) => Promise<unknown>;
  declineSection: (id: string, note: string | null) => Promise<void>;
  mergeSection: (id: string, into: string) => Promise<void>;
  decideTopic: (id: string, decision: TopicDecision) => Promise<void>;
}

const proposalsDeps: ProposalsDeps = {
  sections: loadSectionQueue,
  topics: loadTopicQueue,
  approveSection,
  declineSection,
  mergeSection,
  decideTopic,
};

/** A backend from before section proposals has no queue for them: nothing waits. */
const orNothing =
  <T,>(load: () => Promise<T>, nothing: T) =>
  () =>
    load().catch((reason: unknown) => {
      if (errorOf(reason).kind === "notFound") return nothing;
      throw reason;
    });

type Filter = "all" | "sections" | "topics";

type Opened = { kind: "decline"; note: string } | { kind: "merge"; into: string } | null;

function SectionProposal({
  proposal,
  sections,
  role,
  deps,
  onDone,
  onSettled,
  onEdit,
}: {
  proposal: ProposedSection;
  sections: readonly Section[];
  role: AdminRole;
  deps: ProposalsDeps;
  onDone: (text: string) => void;
  /** Somebody else decided it first: the queue is read again. */
  onSettled: () => void;
  /** The owner's Edit sheet; the card stays in the queue after it. */
  onEdit: () => void;
}) {
  const look = sectionOf(proposal);
  const [now] = useState(() => Date.now());
  const [opened, setOpened] = useState<Opened>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const filedIn = sections.find((one) => one.id === proposal.fileUnder)?.name ?? "";
  const proposer = proposal.proposerName ?? "";

  const act = (work: Promise<unknown>, text: string) => {
    setBusy(true);
    setFailed(false);
    work.then(
      () => onDone(text),
      (reason: unknown) => {
        setBusy(false);
        // 409 SETTLED: somebody else approved, declined or merged it first.
        if (errorOf(reason).kind === "conflict") onSettled();
        else setFailed(true);
      },
    );
  };

  return (
    <li className="proposal">
      <div className="proposal__looks" aria-hidden="true">
        <span className="proposal__tile" style={sectionStyle(look)}>
          <span className="proposal__label">
            <Icon name={look.icon} />
            {look.name}
          </span>
        </span>
        <span className="proposal__small">
          <span className="proposal__tile proposal__tile--light" style={sectionStyle(look)} />
          <span className="proposal__tile proposal__tile--dark" style={sectionStyle(look)} />
        </span>
      </div>
      <div className="proposal__text">
        <h3 className="proposal__name">{look.name}</h3>
        <p className="proposal__meta">
          {fill(strings.admin.sectionMeta, {
            name: proposer,
            when: agoText(proposal.createdAt ?? now, now),
          })}
        </p>
        {proposal.waitingLists !== undefined && proposal.waitingLists > 0 && (
          <p className="proposal__line">
            {fill(plural(strings.admin.filedUnder, proposal.waitingLists), { section: filedIn })}
          </p>
        )}
        <ul className="proposal__swatches" aria-label={strings.admin.colours}>
          {[
            look.tint.light,
            look.tint.dark,
            look.topicBg.light,
            look.topicBg.dark,
            look.topicIcon.dark,
          ].map((colour, at) => (
            <li key={at} style={{ background: colour }} title={colour} />
          ))}
        </ul>
        {failed && (
          <p className="admin__bar" role="alert">
            {strings.admin.actionFailed}
          </p>
        )}
        {opened?.kind === "decline" ? (
          <div className="proposal__open">
            <label className="field">
              <span className="field__label">{fill(strings.admin.noteTo, { name: proposer })}</span>
              <textarea
                maxLength={300}
                value={opened.note}
                onChange={(event) => setOpened({ kind: "decline", note: event.target.value })}
              />
            </label>
            <div className="proposal__actions">
              <Button onClick={() => setOpened(null)}>{strings.admin.cancel}</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  act(
                    deps.declineSection(proposal.id, opened.note.trim() || null),
                    fill(strings.admin.declined, { name: look.name }),
                  )
                }
              >
                {strings.admin.decline}
              </Button>
            </div>
          </div>
        ) : opened?.kind === "merge" ? (
          <div className="proposal__open">
            <label className="field">
              <span className="field__label">{strings.admin.mergeInto}</span>
              <select
                value={opened.into}
                onChange={(event) => setOpened({ kind: "merge", into: event.target.value })}
              >
                {sections.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="proposal__actions">
              <Button onClick={() => setOpened(null)}>{strings.admin.cancel}</Button>
              <Button
                variant="filled"
                disabled={busy}
                onClick={() =>
                  act(
                    deps.mergeSection(proposal.id, opened.into),
                    fill(strings.admin.merged, {
                      name: look.name,
                      into: sections.find((one) => one.id === opened.into)?.name ?? opened.into,
                    }),
                  )
                }
              >
                {strings.admin.merge}
              </Button>
            </div>
          </div>
        ) : (
          <div className="proposal__actions">
            <Button
              variant="filled"
              disabled={busy}
              onClick={() =>
                act(
                  deps.approveSection(proposal.id),
                  fill(strings.admin.approved, { name: look.name }),
                )
              }
            >
              {strings.admin.approve}
            </Button>
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => setOpened({ kind: "decline", note: "" })}
            >
              {strings.admin.decline}
            </Button>
            {role === "owner" && (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => setOpened({ kind: "merge", into: sections[0]?.id ?? "other" })}
              >
                {strings.admin.mergeInto}
              </Button>
            )}
            {role === "owner" && (
              <Button disabled={busy} onClick={onEdit}>
                {strings.admin.edit}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function TopicProposal({
  topic,
  sections,
  deps,
  onDone,
}: {
  topic: PendingTopic;
  sections: readonly Section[];
  deps: ProposalsDeps;
  onDone: (text: string) => void;
}) {
  const wanted = topic.requestedSection ?? topic.section ?? "other";
  const [section, setSection] = useState(wanted);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const look = sections.find((one) => one.id === section);

  const act = (decision: TopicDecision, text: string) => {
    setBusy(true);
    setFailed(false);
    deps.decideTopic(topic.id, decision).then(
      () => onDone(text),
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <li className="proposal">
      <div className="proposal__looks" aria-hidden="true">
        <span
          className="proposal__square"
          style={look === undefined ? undefined : { ...sectionStyle(look), ...topicStyle(look) }}
        >
          <Icon name={look?.icon ?? "label"} />
        </span>
      </div>
      <div className="proposal__text">
        <h3 className="proposal__name">{topic.name}</h3>
        <p className="proposal__meta">
          {fill(strings.admin.topicMeta, {
            section: sections.find((one) => one.id === wanted)?.name ?? wanted,
            name: topic.proposerName ?? "",
          })}
        </p>
        {topic.similar !== undefined && topic.similar.length > 0 && (
          <p className="proposal__line">
            {fill(strings.admin.similar, {
              names: topic.similar.map((one) => one.name).join(", "),
            })}
          </p>
        )}
        <label className="field proposal__section">
          <span className="field__label">{strings.admin.inSection}</span>
          <select value={section} onChange={(event) => setSection(event.target.value)}>
            {sections.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        {failed && (
          <p className="admin__bar" role="alert">
            {strings.admin.actionFailed}
          </p>
        )}
        <div className="proposal__actions">
          <Button
            variant="filled"
            disabled={busy}
            onClick={() =>
              act(
                { action: "approve", section },
                fill(strings.admin.approved, { name: topic.name }),
              )
            }
          >
            {strings.admin.approve}
          </Button>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() =>
              act({ action: "reject" }, fill(strings.admin.declined, { name: topic.name }))
            }
          >
            {strings.admin.decline}
          </Button>
          {(topic.similar ?? []).map((twin) => (
            <Button
              key={twin.id}
              variant="outlined"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "merge", into: twin.id },
                  fill(strings.admin.merged, { name: topic.name, into: twin.name }),
                )
              }
            >
              {fill(strings.admin.mergeIntoName, { name: twin.name })}
            </Button>
          ))}
        </div>
      </div>
    </li>
  );
}

/**
 * Sections and topics people proposed, oldest first: each with what it would
 * look like and the one decision it waits for.
 */
export function ProposalsPane({
  adminRole: role,
  deps = proposalsDeps,
  writes = sectionWrites,
  editor,
}: {
  adminRole: AdminRole;
  deps?: ProposalsDeps;
  /** The owner's Edit of a proposal, and what its form leans on. */
  writes?: SectionWrites;
  editor?: EditorDeps;
}) {
  const loadSections = useCallback(() => orNothing(deps.sections, { sections: [] })(), [deps]);
  const loadTopics = useCallback(() => orNothing(deps.topics, { topics: [] })(), [deps]);
  const sectionQueue = useResource("sections", loadSections);
  const topicQueue = useResource("topics", loadTopics);
  const { sections } = useSections();
  const [filter, setFilter] = useState<Filter>("all");
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [editing, setEditing] = useState<string | null>(null);
  // A proposal as the owner's edit left it, until the queue is read again.
  const [edited, setEdited] = useState<ReadonlyMap<string, ProposedSection>>(new Map());

  if (sectionQueue.state.status === "loading" || topicQueue.state.status === "loading") {
    return <Skeleton height="240px" />;
  }
  if (sectionQueue.state.status === "error" || topicQueue.state.status === "error") {
    return (
      <div className="admin__trouble" role="alert">
        <p>{strings.admin.failed}</p>
        <Button
          variant="tonal"
          icon="refresh"
          onClick={() => {
            sectionQueue.retry();
            topicQueue.retry();
          }}
        >
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }

  const proposedSections = sectionQueue.state.value.sections
    .filter((one) => !gone.has(`s:${one.id}`))
    .map((one) => edited.get(one.id) ?? one);
  const editingProposal = proposedSections.find((one) => one.id === editing);
  const proposedTopics = topicQueue.state.value.topics.filter((one) => !gone.has(`t:${one.id}`));
  const approved = sections.filter((one) => one.status === "approved");
  const done = (key: string) => (text: string) => {
    setGone((before) => new Set([...before, key]));
    setNotice({ text });
  };
  const waiting = proposedSections.length + proposedTopics.length;

  return (
    <section className="admin-pane" aria-labelledby="admin-proposals">
      <header className="admin-pane__head">
        <h2 id="admin-proposals" className="admin-pane__title">
          {strings.admin.proposals}
        </h2>
        <p className="admin-pane__count">{plural(strings.admin.waiting, waiting)}</p>
      </header>
      <div className="admin-pane__chips" role="group" aria-label={strings.admin.proposals}>
        {(
          [
            ["all", strings.search.all],
            [
              "sections",
              fill(strings.sections.group, {
                name: strings.sections.sections,
                n: proposedSections.length,
              }),
            ],
            [
              "topics",
              fill(strings.sections.group, {
                name: strings.sections.topics,
                n: proposedTopics.length,
              }),
            ],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            className={filter === id ? "chip chip--selected" : "chip"}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {text}
          </button>
        ))}
      </div>
      {waiting === 0 ? (
        <div className="admin__empty">
          <Icon name="inbox" className="admin__empty-icon" />
          <p className="admin__empty-title">{strings.admin.nothingTitle}</p>
          <p className="admin__empty-body">{strings.admin.nothingBody}</p>
        </div>
      ) : (
        <ul className="proposals">
          {filter !== "topics" &&
            proposedSections.map((proposal) => (
              <SectionProposal
                key={`s:${proposal.id}`}
                proposal={proposal}
                sections={approved}
                role={role}
                deps={deps}
                onDone={done(`s:${proposal.id}`)}
                onSettled={() => {
                  setNotice({ text: strings.admin.settled });
                  sectionQueue.retry();
                }}
                onEdit={() => setEditing(proposal.id)}
              />
            ))}
          {filter !== "sections" &&
            proposedTopics.map((topic) => (
              <TopicProposal
                key={`t:${topic.id}`}
                topic={topic}
                sections={approved}
                deps={deps}
                onDone={done(`t:${topic.id}`)}
              />
            ))}
        </ul>
      )}
      {editingProposal !== undefined && (
        <SectionEditor
          mode="edit"
          section={editingProposal}
          send={(changes) => writes.edit(editingProposal.id, changes)}
          deps={editor}
          onClose={() => setEditing(null)}
          onDone={(saved) => {
            setEditing(null);
            // Who proposed it and what waits for it stay as the queue said.
            setEdited(new Map(edited).set(saved.id, { ...editingProposal, ...saved }));
            setNotice({ text: fill(strings.admin.sectionSaved, { name: sectionOf(saved).name }) });
          }}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
