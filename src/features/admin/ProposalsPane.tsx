import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type {
  AdminRole,
  FinishCall,
  PendingTopic,
  ProposedSection,
  SectionDraft,
  TopicApproval,
  TopicDecision,
} from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { SectionStats, Topic } from "../../api/sections";
import {
  approveSection,
  approveSectionAsTopic,
  declineSection,
  decideTopic,
  findTopics,
  finishDecision,
  loadSectionQueue,
  loadTopicQueue,
  mergeSection,
  mergeSectionIntoTopic,
} from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { PaneLoading } from "./PaneLoading";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { sectionOf, sectionStyle, topicPath, topicStyle, type Section } from "../sections/model";
import type { EditorDeps } from "../sections/editorDeps";
import { SECTION_NAME_MAX, tidySectionName } from "../sections/proposal";
import { SectionEditor } from "../sections/SectionEditor";
import { TopicArt } from "../sections/TopicArt";
import { heldSection, sectionsStore, useSections } from "../sections/useSections";
import { agoText } from "../moderation/queue";
import { sectionWrites, type SectionWrites } from "./sectionWrites";
import { noteAdminDecision } from "./useAdminCounts";

export interface ProposalsDeps {
  sections: () => Promise<{ sections: ProposedSection[] }>;
  topics: () => Promise<{ topics: PendingTopic[] }>;
  approveSection: (id: string, changes?: Partial<SectionDraft>) => Promise<unknown>;
  /** The proposal becomes a topic of an open section, and its waiting lists go under it. */
  approveAsTopic: (
    id: string,
    approval: TopicApproval,
  ) => Promise<{ topic: Topic | null; proposal: SectionStats | null }>;
  declineSection: (id: string, note: string | null) => Promise<void>;
  mergeSection: (id: string, into: string) => Promise<void>;
  /** The proposal goes into the approved topic that has its name, waiting lists and all. */
  mergeIntoTopic: (
    id: string,
    topic: string,
  ) => Promise<{ topic: Topic | null; proposal: SectionStats | null }>;
  decideTopic: (id: string, decision: TopicDecision) => Promise<void>;
  /** Approved topics whose name starts with what was typed: where a duplicate may go. */
  findTopics: (q: string) => Promise<{ topics: Topic[] }>;
  /** A decision cut short, made again with the call the backend hands back. */
  finish: (id: string, finish: FinishCall) => Promise<unknown>;
}

const proposalsDeps: ProposalsDeps = {
  sections: loadSectionQueue,
  topics: loadTopicQueue,
  approveSection,
  approveAsTopic: approveSectionAsTopic,
  declineSection,
  mergeSection,
  mergeIntoTopic: mergeSectionIntoTopic,
  decideTopic,
  findTopics: (q) => findTopics(q),
  finish: finishDecision,
};

/** How long the merge search waits after the last key before it asks. */
export const FIND_TOPIC_AFTER_MS = 300;

/** A backend from before section proposals has no queue for them: nothing waits. */
const orNothing =
  <T,>(load: () => Promise<T>, nothing: T) =>
  () =>
    load().catch((reason: unknown) => {
      if (errorOf(reason).kind === "notFound") return nothing;
      throw reason;
    });

type Filter = "all" | "sections" | "topics";

/**
 * What a name clashed with, as which, so the field says it and Merge into it
 * knows where. A topic's name is taken in every section, so the section is
 * the one the backend names, when it does.
 */
type Taken = { name: string; as: "section" | "topic"; id: string | null; section: string | null };

/** Approve's own panel (docs/design-spec-walk-3.md, E3): as a section, or as a topic of one. */
type Approving = {
  kind: "approve";
  as: "section" | "topic";
  section: string;
  name: string;
  taken: Taken | null;
};

type Opened =
  { kind: "decline"; note: string } | { kind: "merge"; into: string } | Approving | null;

type Done = (notice: string | SnackbarNotice) => void;

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
  onDone: Done;
  /** Somebody else decided it first: the queue is read again. */
  onSettled: () => void;
  /** The owner's Edit sheet; the card stays in the queue after it. */
  onEdit: () => void;
}) {
  const look = sectionOf(proposal);
  const id = useId();
  const navigate = useNavigate();
  const [now] = useState(() => Date.now());
  const [opened, setOpened] = useState<Opened>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** What the backend refused, said in its place of the plain failure. */
  const [refused, setRefused] = useState<string | null>(null);
  const filedIn = sections.find((one) => one.id === proposal.fileUnder)?.name ?? "";
  const proposer = proposal.proposerName ?? "";
  const waitingLists = proposal.waitingLists ?? 0;
  const nameOf = (section: string) => sections.find((one) => one.id === section)?.name ?? section;

  const act = <T,>(
    work: Promise<T>,
    notice: string | ((done: T) => SnackbarNotice),
    clash?: Omit<Taken, "id" | "section">,
    invalid?: string,
  ) => {
    setBusy(true);
    setFailed(false);
    setRefused(null);
    work.then(
      (done) => onDone(typeof notice === "string" ? notice : notice(done)),
      (reason: unknown) => {
        setBusy(false);
        const error = errorOf(reason);
        // A name already there is said under the name, with the way to merge into it.
        if (clash !== undefined && error.kind === "invalid" && error.code === "NAME_TAKEN") {
          setOpened((before) =>
            before?.kind === "approve"
              ? {
                  ...before,
                  taken: { ...clash, id: error.id ?? null, section: error.section ?? null },
                }
              : before,
          );
          return;
        }
        // 400 INVALID: the backend says why, and it is said instead.
        if (invalid !== undefined && error.kind === "invalid") setRefused(invalid);
        // 409 SETTLED: somebody else approved, declined or merged it first.
        else if (error.kind === "conflict") onSettled();
        else setFailed(true);
      },
    );
  };

  const approve = (panel: Approving) => {
    const name = tidySectionName(panel.name);
    const renamed = name !== tidySectionName(look.name);
    if (panel.as === "section") {
      act(
        deps.approveSection(proposal.id, renamed ? { name } : {}),
        fill(strings.admin.approved, { name }),
        { name, as: "section" },
      );
      return;
    }
    act(
      deps.approveAsTopic(proposal.id, { section: panel.section, ...(renamed ? { name } : {}) }),
      ({ topic }) => {
        // Where the backend put it: a request repeated after somebody else's
        // half-done approval answers with theirs.
        const section = topic?.section ?? panel.section;
        return {
          text: [
            fill(strings.admin.approvedAsTopic, {
              name: topic?.name ?? name,
              section: nameOf(section),
            }),
            ...lineOfLists,
          ].join(" · "),
          ...(topic === null
            ? {}
            : {
                action: {
                  text: strings.admin.open,
                  onClick: () => void navigate(topicPath(section, topic.id)),
                },
              }),
        };
      },
      { name, as: "topic" },
    );
  };

  const lineOfLists = waitingLists > 0 ? [plural(strings.admin.listsMoved, waitingLists)] : [];

  /** Into an approved topic that has the name: its lists go under it, and it can be opened. */
  const mergeIntoTopic = (topicId: string, topicName: string, section: string | null) =>
    act(
      deps.mergeIntoTopic(proposal.id, topicId),
      ({ topic }) => {
        const where = topic?.section ?? section;
        return {
          text: [
            fill(strings.admin.mergedIntoTopic, {
              name: look.name,
              topic: topic?.name ?? topicName,
              section: where === null ? "" : nameOf(where),
            }),
            ...lineOfLists,
          ].join(" · "),
          ...(where === null
            ? {}
            : {
                action: {
                  text: strings.admin.open,
                  onClick: () => void navigate(topicPath(where, topic?.id ?? topicId)),
                },
              }),
        };
      },
      undefined,
      fill(strings.admin.topicMergeRefused, { topic: topicName }),
    );

  const mergeIntoSection = (into: string) =>
    act(
      deps.mergeSection(proposal.id, into),
      fill(strings.admin.merged, { name: look.name, into: nameOf(into) }),
    );

  /**
   * Merge into what the name clashed with: the topic when the backend named
   * it, or else the section, or the section the topic was to go into.
   */
  const mergeInto = (panel: Approving, taken: Taken) => {
    if (taken.as === "topic" && taken.id !== null) {
      mergeIntoTopic(taken.id, taken.name, taken.section ?? panel.section);
      return;
    }
    const into = taken.as === "section" ? taken.id : panel.section;
    if (into !== null) mergeIntoSection(into);
  };
  /** A topic is merged into by any staff; a section, by the owner alone. */
  const mayMerge = (taken: Taken) =>
    taken.as === "topic"
      ? taken.id !== null || role === "owner"
      : role === "owner" && taken.id !== null;
  const clash = proposal.nameClash ?? null;

  const approving = opened?.kind === "approve" ? opened : null;
  const approvingName = approving === null ? "" : tidySectionName(approving.name);
  // A clash is said while the name and the choice are still the ones it was about.
  const taken = approving?.taken ?? null;
  const shownTaken =
    taken !== null && taken.name === approvingName && taken.as === approving?.as ? taken : null;

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
        {clash !== null && (
          <p className="proposal__clash">
            <Icon name="info" />
            <span>
              {clash.kind === "topic"
                ? fill(strings.admin.topicTaken, {
                    name: clash.name,
                    section:
                      clash.sectionName ?? (clash.section === null ? "" : nameOf(clash.section)),
                  })
                : fill(strings.admin.sectionTaken, { name: clash.name })}
            </span>
            {(clash.kind === "topic" || role === "owner") && (
              <Button
                disabled={busy}
                onClick={() =>
                  clash.kind === "topic"
                    ? mergeIntoTopic(clash.id, clash.name, clash.section)
                    : mergeIntoSection(clash.id)
                }
              >
                {strings.admin.mergeIntoIt}
              </Button>
            )}
          </p>
        )}
        {(failed || refused !== null) && (
          <p className="admin__bar" role="alert">
            {refused ?? strings.admin.actionFailed}
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
        ) : approving !== null ? (
          <div className="proposal__open proposal__approve">
            <div className="proposal__choices" role="radiogroup" aria-label={strings.admin.approve}>
              <label className="proposal__choice">
                <input
                  type="radio"
                  name={`${id}-as`}
                  checked={approving.as === "section"}
                  onChange={() => setOpened({ ...approving, as: "section" })}
                />
                <span>{strings.admin.approveAsSection}</span>
              </label>
              <span className="proposal__choice">
                <label className="proposal__choice-label">
                  <input
                    type="radio"
                    name={`${id}-as`}
                    checked={approving.as === "topic"}
                    onChange={() => setOpened({ ...approving, as: "topic" })}
                  />
                  <span>{strings.admin.approveAsTopicIn}</span>
                </label>
                <select
                  aria-label={strings.admin.inSection}
                  value={approving.section}
                  onChange={(event) =>
                    setOpened({ ...approving, as: "topic", section: event.target.value })
                  }
                >
                  {sections.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <label className="field">
              <span className="field__label">{strings.admin.topicName}</span>
              <input
                maxLength={SECTION_NAME_MAX}
                value={approving.name}
                aria-invalid={shownTaken !== null}
                aria-describedby={shownTaken === null ? undefined : `${id}-taken`}
                onChange={(event) => setOpened({ ...approving, name: event.target.value })}
              />
            </label>
            <div className="proposal__under">
              {shownTaken !== null && (
                <p id={`${id}-taken`} className="proposal__error" role="alert">
                  {shownTaken.as === "section"
                    ? fill(strings.admin.sectionTaken, { name: shownTaken.name })
                    : shownTaken.section === null
                      ? fill(strings.admin.topicExists, { name: shownTaken.name })
                      : fill(strings.admin.topicTaken, {
                          name: shownTaken.name,
                          section: nameOf(shownTaken.section),
                        })}
                  {mayMerge(shownTaken) && (
                    <Button disabled={busy} onClick={() => mergeInto(approving, shownTaken)}>
                      {strings.admin.mergeIntoIt}
                    </Button>
                  )}
                </p>
              )}
              <span className="field__counter" aria-hidden="true">
                {fill(strings.settings.nameCounter, {
                  n: approving.name.length,
                  max: SECTION_NAME_MAX,
                })}
              </span>
            </div>
            {waitingLists > 0 && (
              <p className="proposal__consequence">
                {plural(strings.admin.listsMoveWith, waitingLists)}
              </p>
            )}
            <div className="proposal__actions">
              <Button onClick={() => setOpened(null)}>{strings.admin.cancel}</Button>
              <Button
                variant="filled"
                disabled={busy || approvingName === ""}
                onClick={() => approve(approving)}
              >
                {approving.as === "section"
                  ? strings.admin.approveAsSection
                  : strings.admin.approveAsTopic}
              </Button>
            </div>
          </div>
        ) : (
          <div className="proposal__actions">
            <Button
              variant="filled"
              disabled={busy}
              onClick={() =>
                setOpened({
                  kind: "approve",
                  as: "section",
                  section: sections.some((one) => one.id === proposal.fileUnder)
                    ? (proposal.fileUnder ?? "")
                    : (sections[0]?.id ?? "other"),
                  name: look.name,
                  taken: null,
                })
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

/**
 * A decision made but cut short: its lists did not all move. It says so, and
 * Finish makes the same call again, which the backend carries on from where
 * it stopped. A merge into a section stays the owner's.
 */
function UnfinishedDecision({
  proposal,
  role,
  deps,
  onDone,
  onSettled,
}: {
  proposal: ProposedSection;
  role: AdminRole;
  deps: ProposalsDeps;
  onDone: Done;
  onSettled: () => void;
}) {
  const look = sectionOf(proposal);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const finish = proposal.finish;
  const allowed = finish !== undefined && (finish.action !== "merge" || role === "owner");

  return (
    <li className="proposal">
      <div className="proposal__looks" aria-hidden="true">
        <span className="proposal__tile" style={sectionStyle(look)}>
          <span className="proposal__label">
            <Icon name={look.icon} />
            {look.name}
          </span>
        </span>
      </div>
      <div className="proposal__text">
        <h3 className="proposal__name">{look.name}</h3>
        <p className="proposal__clash">
          <Icon name="info" />
          <span>{strings.admin.unfinishedNote}</span>
        </p>
        {failed && (
          <p className="admin__bar" role="alert">
            {strings.admin.actionFailed}
          </p>
        )}
        {!allowed && finish !== undefined && (
          <p className="proposal__line">{strings.admin.unfinishedOwnerOnly}</p>
        )}
        {allowed && (
          <div className="proposal__actions">
            <Button
              variant="filled"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(false);
                deps.finish(proposal.id, finish).then(
                  () => onDone(fill(strings.admin.finished, { name: look.name })),
                  (reason: unknown) => {
                    setBusy(false);
                    // 409 SETTLED: somebody else finished it first.
                    if (errorOf(reason).kind === "conflict") onSettled();
                    else setFailed(true);
                  },
                );
              }}
            >
              {strings.admin.finish}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Who proposed a topic, as the reports queue names a list's author: a topic
 * first named by an anonymous list comes to a moderator without its proposer,
 * and to the owner with the name, marked as hidden from the others.
 */
function proposerOf(topic: PendingTopic): string {
  const name = topic.proposerName ?? "";
  if (topic.proposedAnonymously !== true) return name || strings.admin.anonymousAuthor;
  return name ? fill(strings.admin.anonymousOf, { name }) : strings.admin.anonymousAuthor;
}

function TopicProposal({
  topic,
  sections,
  role,
  nameOf,
  deps,
  onDone,
  onSettled,
}: {
  topic: PendingTopic;
  /** The open sections: the only ones the backend approves a topic into. */
  sections: readonly Section[];
  role: AdminRole;
  /** A section's name, hidden or waiting ones included, as far as the site knows it. */
  nameOf: (id: string) => string;
  deps: ProposalsDeps;
  onDone: Done;
  /** Somebody else decided it first: the queue is read again. */
  onSettled: () => void;
}) {
  const wanted = topic.requestedSection ?? topic.section ?? "other";
  // A section hidden since it was asked for is no choice: the select starts on
  // one it lists, so Approve sends what is shown.
  const [section, setSection] = useState(() =>
    sections.some((one) => one.id === wanted) ? wanted : (sections[0]?.id ?? wanted),
  );
  // Merging a topic is the owner's alone: the backend refuses anybody else.
  const mayMerge = role === "owner";
  // A hidden section is not among the sections read: asked about, it is named.
  useEffect(() => sectionsStore.lookUp(wanted), [wanted]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A misspelt name is put right before it is approved, as the app's queue does.
  const [name, setName] = useState(topic.name);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamed, setRenamed] = useState(false);
  // A duplicate goes into any approved topic, not only the ones the backend thought alike.
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly Topic[]>([]);
  const look = sections.find((one) => one.id === section);

  useEffect(() => {
    const words = query.trim();
    if (words.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      deps.findTopics(words).then(
        (answer) => {
          if (!current) return;
          setFound(answer.topics.filter((one) => one.status === "approved" && one.id !== topic.id));
        },
        () => {
          if (current) setFound([]);
        },
      );
    }, FIND_TOPIC_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, deps, topic.id]);

  const act = (decision: TopicDecision, text: string) => {
    setBusy(true);
    setFailed(false);
    deps.decideTopic(topic.id, decision).then(
      () => onDone(text),
      (reason: unknown) => {
        setBusy(false);
        // 409 SETTLED: somebody else approved, rejected or merged it first; asking again never helps.
        if (errorOf(reason).kind === "conflict") onSettled();
        else setFailed(true);
      },
    );
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const typed = tidySectionName(renaming ?? "");
    if (typed === "" || typed === name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    setFailed(false);
    deps.decideTopic(topic.id, { action: "rename", name: typed }).then(
      () => {
        setBusy(false);
        setName(typed);
        setRenaming(null);
        setRenamed(true);
      },
      (reason: unknown) => {
        setBusy(false);
        if (errorOf(reason).kind === "conflict") onSettled();
        else setFailed(true);
      },
    );
  };

  const twins = [...(topic.similar ?? []), ...found].filter(
    (one, at, all) => all.findIndex((other) => other.id === one.id) === at,
  );

  return (
    <li className="proposal">
      <div className="proposal__looks" aria-hidden="true">
        <span
          className="proposal__square"
          style={look === undefined ? undefined : { ...sectionStyle(look), ...topicStyle(look) }}
        >
          <TopicArt topic={topic} icon={look?.icon ?? "label"} />
        </span>
      </div>
      <div className="proposal__text">
        <h3 className="proposal__name">{name}</h3>
        {renamed && (
          <p className="proposal__line" role="status">
            {fill(strings.admin.topicRenamed, { name })}
          </p>
        )}
        <p className="proposal__meta">
          {fill(strings.admin.topicMeta, {
            section: nameOf(wanted),
            name: proposerOf(topic),
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
        {mayMerge && (
          <label className="field proposal__section">
            <span className="field__label">{strings.admin.mergeFind}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value.trim().length < 2) setFound([]);
              }}
            />
          </label>
        )}
        {failed && (
          <p className="admin__bar" role="alert">
            {strings.admin.actionFailed}
          </p>
        )}
        {renaming !== null ? (
          <form className="proposal__actions" onSubmit={rename}>
            <label className="field proposal__section">
              <span className="field__label">{strings.admin.topicName}</span>
              <input
                value={renaming}
                maxLength={SECTION_NAME_MAX}
                autoComplete="off"
                onChange={(event) => setRenaming(event.target.value)}
              />
            </label>
            <Button variant="filled" type="submit" disabled={busy}>
              {strings.admin.save}
            </Button>
            <Button onClick={() => setRenaming(null)} disabled={busy}>
              {strings.admin.cancel}
            </Button>
          </form>
        ) : (
          <div className="proposal__actions">
            <Button
              variant="filled"
              disabled={busy}
              onClick={() =>
                act({ action: "approve", section }, fill(strings.admin.approved, { name }))
              }
            >
              {strings.admin.approve}
            </Button>
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => act({ action: "reject" }, fill(strings.admin.declined, { name }))}
            >
              {strings.admin.decline}
            </Button>
            <Button variant="outlined" disabled={busy} onClick={() => setRenaming(name)}>
              {strings.admin.rename}
            </Button>
            {(mayMerge ? twins : []).map((twin) => (
              <Button
                key={twin.id}
                variant="outlined"
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "merge", into: twin.id },
                    fill(strings.admin.merged, { name, into: twin.name }),
                  )
                }
              >
                {fill(strings.admin.mergeIntoName, { name: twin.name })}
              </Button>
            ))}
          </div>
        )}
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
  const held = useSections();
  const { sections } = held;
  const [filter, setFilter] = useState<Filter>("all");
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [editing, setEditing] = useState<string | null>(null);
  // A proposal as the owner's edit left it, until the queue is read again.
  const [edited, setEdited] = useState<ReadonlyMap<string, ProposedSection>>(new Map());

  if (sectionQueue.state.status === "loading" || topicQueue.state.status === "loading") {
    return <PaneLoading />;
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

  const queued = sectionQueue.state.value.sections.filter((one) => !gone.has(`s:${one.id}`));
  // Decisions cut short come after the waiting ones, and are no proposals to decide.
  const unfinished = queued.filter((one) => one.unfinished === true);
  const proposedSections = queued
    .filter((one) => one.unfinished !== true)
    .map((one) => edited.get(one.id) ?? one);
  const editingProposal = proposedSections.find((one) => one.id === editing);
  const proposedTopics = topicQueue.state.value.topics.filter((one) => !gone.has(`t:${one.id}`));
  const approved = sections.filter((one) => one.status === "approved");
  const nameOf = (id: string) => heldSection(held, id)?.name ?? id;
  const done =
    (key: string): Done =>
    (said) => {
      setGone((before) => new Set([...before, key]));
      setNotice(typeof said === "string" ? { text: said } : said);
      // The menu's count of what waits is read again.
      noteAdminDecision();
    };
  const waiting = proposedSections.length + unfinished.length + proposedTopics.length;
  // A chip with nothing under it says so, as an empty queue does.
  const shown =
    (filter === "topics" ? 0 : proposedSections.length + unfinished.length) +
    (filter === "sections" ? 0 : proposedTopics.length);

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
                n: proposedSections.length + unfinished.length,
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
      {shown === 0 ? (
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
          {filter !== "topics" &&
            unfinished.map((proposal) => (
              <UnfinishedDecision
                key={`s:${proposal.id}`}
                proposal={proposal}
                role={role}
                deps={deps}
                onDone={done(`s:${proposal.id}`)}
                onSettled={() => {
                  setNotice({ text: strings.admin.settled });
                  sectionQueue.retry();
                }}
              />
            ))}
          {filter !== "sections" &&
            proposedTopics.map((topic) => (
              <TopicProposal
                key={`t:${topic.id}`}
                topic={topic}
                sections={approved}
                role={role}
                nameOf={nameOf}
                deps={deps}
                onDone={done(`t:${topic.id}`)}
                onSettled={() => {
                  setNotice({ text: strings.admin.settled });
                  topicQueue.retry();
                }}
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
