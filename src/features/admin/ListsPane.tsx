import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AdminList,
  AdminListsQuery,
  AdminRole,
  AdminSections,
  ListMove,
  ProposedSection,
} from "../../api/admin";
import { errorOf } from "../../api/errors";
import type { Topic } from "../../api/sections";
import {
  loadAdminLists,
  loadAdminSections,
  loadSectionQueue,
  loadTopics,
  moveList,
} from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { useWidthClass } from "../../lib/useWidthClass";
import { currentLocale, fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Menu } from "../../ui/Menu";
import { Skeleton } from "../../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { useModal } from "../../ui/useModal";
import { sectionOf, sectionStyle, type Section } from "../sections/model";
import { fileUnderChoices } from "../sections/proposal";

type Page = { lists: AdminList[]; nextCursor: string | null };

export interface ListsDeps {
  /** Every section as staff read them, hidden ones too: the groups, and where a list may go. */
  sections: () => Promise<AdminSections>;
  topics: (section: string) => Promise<{ topics: Topic[] }>;
  lists: (query: AdminListsQuery) => Promise<Page>;
  move: (id: string, to: ListMove) => Promise<void>;
  /** The waiting section proposals: which sections hold lists that wait for one. */
  proposals: () => Promise<{ sections: ProposedSection[] }>;
}

const listsDeps: ListsDeps = {
  sections: loadAdminSections,
  topics: (section) => loadTopics(section, 50),
  lists: loadAdminLists,
  move: moveList,
  proposals: loadSectionQueue,
};

/** How long a moved row takes to slide out of its group. */
export const LEAVE_MS = 180;

/** Where a list is: its section, and its topic or none. */
interface Place {
  section: string;
  topic: { id: string; name: string } | null;
}

const placeOf = (list: AdminList): Place => ({
  section: list.category,
  topic:
    list.topicId === undefined || list.topicId === null
      ? null
      : { id: list.topicId, name: list.topicName ?? "" },
});

const groupKey = (section: string, topic: string | null) => `${section}/${topic ?? "none"}`;

const moveTo = (place: Place): ListMove =>
  place.topic === null ? { category: place.section, topicId: null } : { topicId: place.topic.id };

/** What a list waits for before it may be moved without asking: a proposal named, or maybe one. */
type Waits = { kind: "known"; name: string } | { kind: "maybe"; names: string } | null;

/**
 * Whether moving the list takes it out of a waiting proposal. The backend says
 * so when it sends `proposedSection`; when it does not, a list without a topic
 * in a section that waiting proposals file their lists under may be one of them.
 */
function waitsOf(list: AdminList, proposals: readonly ProposedSection[]): Waits {
  if (typeof list.proposedSection === "string" && list.proposedSection !== "") {
    return { kind: "known", name: list.proposedSectionName ?? list.proposedSection };
  }
  if (list.proposedSection !== undefined || (list.topicId ?? null) !== null) return null;
  const filed = proposals.filter(
    (one) => one.fileUnder === list.category && (one.waitingLists ?? 0) > 0,
  );
  return filed.length === 0
    ? null
    : { kind: "maybe", names: filed.map((one) => sectionOf(one).name).join(", ") };
}

const dayOf = (millis: number) =>
  new Intl.DateTimeFormat(currentLocale(), { day: "numeric", month: "short" }).format(millis);

/** The list's own picture at 40 × 56: its cover, its first card, or its tier colours. */
function Cover({ list }: { list: AdminList }) {
  const picture = list.coverImageUrl ?? list.previewImages[0] ?? null;
  return (
    <span className="admin-list__cover" aria-hidden="true">
      {picture !== null ? (
        <img src={picture} alt="" loading="lazy" />
      ) : (
        list.tierColors
          .slice(0, 5)
          .map((colour, at) => <span key={at} style={{ backgroundColor: colour }} />)
      )}
    </span>
  );
}

function ListRow({
  list,
  role,
  narrow,
  leaving,
  onMove,
}: {
  list: AdminList;
  role: AdminRole;
  narrow: boolean;
  leaving: boolean;
  onMove: () => void;
}) {
  const href = `/l/${encodeURIComponent(list.id)}`;
  // Who wrote an anonymous list is the owner's to know (docs/design-spec-walk-3.md, E2).
  const author =
    list.anonymous === true
      ? role === "owner"
        ? fill(strings.admin.anonymousOf, { name: list.publishedBy.name })
        : strings.admin.anonymousAuthor
      : list.publishedBy.name || list.authorName;
  const waiting =
    typeof list.proposedSection === "string" && list.proposedSection !== ""
      ? (list.proposedSectionName ?? list.proposedSection)
      : null;

  return (
    <li className={leaving ? "admin-list admin-list--leaving" : "admin-list"}>
      <Cover list={list} />
      <span className="admin-list__text">
        <span className="admin-list__title">{list.title}</span>
        <span className="admin-list__meta">
          {[plural(strings.card.rankings, list.takeCount), author, dayOf(list.updatedAt)].join(
            " · ",
          )}
        </span>
      </span>
      {list.underReview && (
        <span className="admin-list__pill">
          <Icon name="schedule" />
          {strings.admin.underReview}
        </span>
      )}
      {waiting !== null && (
        <span className="admin-list__pill">
          {fill(strings.admin.waitsForMark, { name: waiting })}
        </span>
      )}
      {narrow ? (
        <Menu
          label={fill(strings.admin.listActions, { title: list.title })}
          button={<Icon name="more_vert" />}
        >
          <li>
            <a className="menu__action" href={href} target="_blank" rel="noopener">
              {strings.admin.open}
            </a>
          </li>
          <li>
            <button type="button" className="menu__action" onClick={onMove}>
              {strings.admin.moveList}
            </button>
          </li>
        </Menu>
      ) : (
        <span className="admin-list__actions">
          <Button href={href} external>
            {strings.admin.open}
          </Button>
          <Button onClick={onMove}>{strings.admin.moveList}</Button>
        </span>
      )}
    </li>
  );
}

interface GroupProps {
  section: Section;
  topic: Topic | null;
  count: number;
  role: AdminRole;
  narrow: boolean;
  query: string;
  deps: ListsDeps;
  /** Bumped to read the group again: a list moved into it, or moved back out. */
  round: number;
  gone: ReadonlySet<string>;
  leaving: ReadonlySet<string>;
  onMove: (list: AdminList) => void;
}

/** Whether a list answers the search: by its title, or by an author this person may know. */
const matches = (list: AdminList, query: string, role: AdminRole) => {
  if (query === "") return true;
  const asked = query.toLocaleLowerCase();
  const hidden = list.anonymous === true && role !== "owner";
  return [list.title, ...(hidden ? [] : [list.publishedBy.name, list.authorName])].some((text) =>
    text.toLocaleLowerCase().includes(asked),
  );
};

/** One topic's lists in a section, or those with none: twenty, then twenty more on request. */
function ListGroup({
  section,
  topic,
  count,
  role,
  narrow,
  query,
  deps,
  round,
  gone,
  leaving,
  onMove,
}: GroupProps) {
  const key = groupKey(section.id, topic?.id ?? null);
  const ask = useCallback(
    (after: string | null) =>
      deps.lists({ section: section.id, topic: topic?.id ?? "none", sort: "recent", after }),
    [deps, section.id, topic],
  );
  const first = useCallback(() => ask(null), [ask]);
  const { state, retry } = useResource(`${key}:${round}`, first);
  const [more, setMore] = useState<{ round: number; page: Page } | null>(null);
  const [failed, setFailed] = useState(false);
  const extra = more !== null && more.round === round ? more.page : null;

  const page = state.status === "ready" ? state.value : null;
  const loaded = [...(page?.lists ?? []), ...(extra?.lists ?? [])];
  const rows = loaded.filter(
    (list) => !gone.has(`${key}|${list.id}`) && matches(list, query, role),
  );
  const next = extra !== null ? extra.nextCursor : (page?.nextCursor ?? null);
  const title = fill(strings.sections.group, {
    name: topic?.name ?? strings.admin.noTopic,
    n: count,
  });

  if (query !== "" && rows.length === 0) return null;

  const showMore = (cursor: string) => {
    setFailed(false);
    ask(cursor).then(
      (answer) =>
        setMore({
          round,
          page: {
            lists: [...(extra?.lists ?? []), ...answer.lists],
            nextCursor: answer.nextCursor,
          },
        }),
      (reason: unknown) => {
        // The list the page ended at went: the group starts again from the top.
        if (errorOf(reason).kind === "cursorGone") {
          setMore(null);
          retry();
        } else {
          setFailed(true);
        }
      },
    );
  };

  return (
    <section className="admin-lists__group" aria-label={title}>
      <h4 className="admin-lists__topic">{title}</h4>
      {state.status === "loading" ? (
        <Skeleton height="64px" />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{strings.admin.failed}</p>
          <Button variant="tonal" icon="refresh" onClick={retry}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="admin-pane__note">{strings.admin.noListsHere}</p>
      ) : (
        <ul className="admin-lists__rows">
          {rows.map((list) => (
            <ListRow
              key={list.id}
              list={list}
              role={role}
              narrow={narrow}
              leaving={leaving.has(`${key}|${list.id}`)}
              onMove={() => onMove(list)}
            />
          ))}
        </ul>
      )}
      {failed && (
        <p className="admin__bar" role="alert">
          {strings.admin.actionFailed}
        </p>
      )}
      {next !== null && state.status === "ready" && (
        <Button onClick={() => showMore(next)}>{strings.admin.showMore20}</Button>
      )}
    </section>
  );
}

interface SectionGroupProps extends Omit<GroupProps, "topic" | "count" | "round"> {
  open: boolean;
  onToggle: () => void;
  rounds: ReadonlyMap<string, number>;
  /** How many lists moved in (+) or out (−) since the counts were read, by `s:` or `t:` id. */
  delta: ReadonlyMap<string, number>;
}

/** A section's sticky head with its count, and when open its topics' groups, No topic last. */
function SectionGroup({
  section,
  open,
  onToggle,
  rounds,
  delta,
  deps,
  ...group
}: SectionGroupProps) {
  const id = useId();
  const load = useCallback(() => deps.topics(section.id), [deps, section.id]);
  const total = Math.max(0, section.listCount + (delta.get(`s:${section.id}`) ?? 0));

  return (
    <section className="admin-lists__section" aria-labelledby={`${id}-head`}>
      <h3 className="admin-lists__head" id={`${id}-head`}>
        <button
          type="button"
          className="admin-lists__toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span className="admin-lists__swatch" style={sectionStyle(section)} aria-hidden="true" />
          <span className="admin-lists__name">{section.name}</span>
          <span className="admin-lists__count">{plural(strings.sections.lists, total)}</span>
          <Icon
            name="expand_more"
            className={
              open ? "admin-lists__chevron admin-lists__chevron--open" : "admin-lists__chevron"
            }
          />
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open}>
        {open && (
          <Topics
            section={section}
            total={total}
            load={load}
            rounds={rounds}
            delta={delta}
            deps={deps}
            {...group}
          />
        )}
      </div>
    </section>
  );
}

function Topics({
  section,
  total,
  load,
  rounds,
  delta,
  deps,
  ...group
}: Omit<SectionGroupProps, "open" | "onToggle"> & {
  total: number;
  load: () => Promise<{ topics: Topic[] }>;
}) {
  const { state, retry } = useResource(`topics:${section.id}`, load);
  const topics =
    state.status === "ready" ? state.value.topics.filter((one) => one.status === "approved") : [];

  if (state.status === "loading") return <Skeleton height="104px" />;
  if (state.status === "error") {
    return (
      <div className="admin__trouble" role="alert">
        <p>{strings.admin.failed}</p>
        <Button variant="tonal" icon="refresh" onClick={retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }
  const countOf = (topic: Topic) =>
    Math.max(0, topic.listCount + (delta.get(`t:${topic.id}`) ?? 0));
  const shown = topics.filter((topic) => countOf(topic) > 0);
  const withTopic = shown.reduce((sum, topic) => sum + countOf(topic), 0);
  return (
    <>
      {shown.map((topic) => (
        <ListGroup
          key={topic.id}
          section={section}
          topic={topic}
          count={countOf(topic)}
          round={rounds.get(groupKey(section.id, topic.id)) ?? 0}
          deps={deps}
          {...group}
        />
      ))}
      <ListGroup
        section={section}
        topic={null}
        count={Math.max(0, total - withTopic)}
        round={rounds.get(groupKey(section.id, null)) ?? 0}
        deps={deps}
        {...group}
      />
    </>
  );
}

/**
 * Move “title” (docs/design-spec-walk-3.md, E2): a dialog 400 wide, a sheet
 * from the bottom below 840. The section, then its topic or none. A list that
 * waits for a proposed section says so first, and moves only when asked again.
 */
function MoveDialog({
  list,
  sections,
  waits,
  narrow,
  busy,
  failed,
  deps,
  onMove,
  onClose,
}: {
  list: AdminList;
  sections: readonly Section[];
  waits: Waits;
  narrow: boolean;
  busy: boolean;
  failed: boolean;
  deps: ListsDeps;
  onMove: (to: Place) => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const from = placeOf(list);
  const [section, setSection] = useState(
    sections.some((one) => one.id === from.section) ? from.section : (sections[0]?.id ?? "other"),
  );
  const [topicId, setTopicId] = useState(from.topic?.id ?? "");
  const load = useCallback((asked: string) => deps.topics(asked), [deps]);
  const { state } = useResource(section, load);
  const topics =
    state.status === "ready" ? state.value.topics.filter((one) => one.status === "approved") : [];
  const topic = topics.find((one) => one.id === topicId) ?? null;
  const close = () => {
    if (!busy) onClose();
  };
  useModal(box, close);

  const same = section === from.section && (topic?.id ?? null) === (from.topic?.id ?? null);
  const ready = !same && (topicId === "" || topic !== null);

  return createPortal(
    <div className={narrow ? "scrim move-dialog__scrim--sheet" : "scrim"} onClick={close}>
      <div
        ref={box}
        className={narrow ? "dialog move-dialog move-dialog--sheet" : "dialog move-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {fill(strings.admin.moveTitle, { title: list.title })}
        </h2>
        <div className="move-dialog__fields">
          <label className="field">
            <span className="field__label">{strings.admin.inSection}</span>
            <select
              value={section}
              disabled={busy}
              onChange={(event) => {
                setSection(event.target.value);
                setTopicId("");
              }}
            >
              {sections.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{strings.admin.topic}</span>
            <select
              value={topicId}
              disabled={busy || state.status !== "ready"}
              onChange={(event) => setTopicId(event.target.value)}
            >
              <option value="">{strings.admin.noTopic}</option>
              {topics.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {waits !== null && (
          <p className="move-dialog__waits" role="note">
            {waits.kind === "known"
              ? fill(strings.admin.waitsFor, { name: waits.name })
              : fill(strings.admin.mayWait, { names: waits.names })}
          </p>
        )}
        {failed && (
          <p className="admin__bar" role="alert">
            {strings.admin.actionFailed}
          </p>
        )}
        <div className="dialog__actions">
          <Button onClick={close} disabled={busy}>
            {strings.admin.cancel}
          </Button>
          <Button
            variant="filled"
            disabled={busy || !ready}
            onClick={() =>
              onMove({
                section,
                topic: topic === null ? null : { id: topic.id, name: topic.name },
              })
            }
          >
            {waits === null ? strings.admin.moveList : strings.admin.moveAnyway}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A move made, for its Undo and its counts. */
interface Moved {
  list: AdminList;
  from: Place;
  to: Place;
}

/**
 * Every published list, by section and then by topic, as staff see them
 * (docs/design-spec-walk-3.md, E2): under review ones too, who published
 * each, and the way to move one elsewhere, with Undo. Each open section
 * reads its topics and their lists, twenty at a time; the search narrows
 * what the open sections have read.
 */
export function ListsPane({
  adminRole: role,
  deps = listsDeps,
}: {
  adminRole: AdminRole;
  deps?: ListsDeps;
}) {
  const narrow = useWidthClass() !== "expanded";
  const loadSections = useCallback(() => deps.sections(), [deps]);
  const sectionsRead = useResource("admin-lists", loadSections);
  const loadProposals = useCallback(
    () => deps.proposals().catch(() => ({ sections: [] as ProposedSection[] })),
    [deps],
  );
  const proposalsRead = useResource("admin-lists-proposals", loadProposals);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [rounds, setRounds] = useState<ReadonlyMap<string, number>>(new Map());
  const [delta, setDelta] = useState<ReadonlyMap<string, number>>(new Map());
  const [moving, setMoving] = useState<AdminList | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  if (sectionsRead.state.status === "loading") return <Skeleton height="240px" />;
  if (sectionsRead.state.status === "error") {
    return (
      <div className="admin__trouble" role="alert">
        <p>{strings.admin.failed}</p>
        <Button variant="tonal" icon="refresh" onClick={sectionsRead.retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }

  const sections = fileUnderChoices(sectionsRead.state.value.sections.map((one) => sectionOf(one)));
  const proposals =
    proposalsRead.state.status === "ready" ? proposalsRead.state.value.sections : [];
  const nameOf = (id: string) => sections.find((one) => one.id === id)?.name ?? id;
  const whereOf = (place: Place) =>
    [nameOf(place.section), ...(place.topic === null ? [] : [place.topic.name])].join(" · ");

  const bump = (key: string) =>
    setRounds((before) => new Map(before).set(key, (before.get(key) ?? 0) + 1));
  /** The counts as a move changes them: one fewer where it was, one more where it went. */
  const shift = (from: Place, to: Place) =>
    setDelta((before) => {
      const next = new Map(before);
      const add = (key: string, n: number) => next.set(key, (next.get(key) ?? 0) + n);
      add(`s:${from.section}`, -1);
      add(`s:${to.section}`, 1);
      if (from.topic !== null) add(`t:${from.topic.id}`, -1);
      if (to.topic !== null) add(`t:${to.topic.id}`, 1);
      return next;
    });

  const undo = ({ list, from, to }: Moved) => {
    deps.move(list.id, moveTo(from)).then(
      () => {
        const fromKey = `${groupKey(from.section, from.topic?.id ?? null)}|${list.id}`;
        setGone((before) => new Set([...before].filter((key) => key !== fromKey)));
        shift(to, from);
        bump(groupKey(to.section, to.topic?.id ?? null));
        setNotice({ text: fill(strings.admin.movedBack, { where: whereOf(from) }) });
      },
      () => setNotice({ text: strings.admin.actionFailed }),
    );
  };

  const move = (list: AdminList, to: Place) => {
    const from = placeOf(list);
    setBusy(true);
    setFailed(false);
    deps.move(list.id, moveTo(to)).then(
      () => {
        setBusy(false);
        setMoving(null);
        const key = `${groupKey(from.section, from.topic?.id ?? null)}|${list.id}`;
        setLeaving((before) => new Set([...before, key]));
        timers.current.push(
          window.setTimeout(() => {
            setGone((before) => new Set([...before, key]));
            setLeaving((before) => new Set([...before].filter((one) => one !== key)));
          }, LEAVE_MS),
        );
        shift(from, to);
        bump(groupKey(to.section, to.topic?.id ?? null));
        setNotice({
          text: fill(strings.admin.listMoved, { where: whereOf(to) }),
          action: { text: strings.sections.undo, onClick: () => undo({ list, from, to }) },
        });
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <section className="admin-pane admin-lists" aria-labelledby="admin-lists">
      <header className="admin-pane__head">
        <h2 id="admin-lists" className="admin-pane__title">
          {strings.admin.lists}
        </h2>
      </header>
      <label className="admin-lists__search">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          placeholder={strings.admin.searchLists}
          aria-label={strings.admin.searchLists}
          aria-describedby="admin-lists-search-help"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p id="admin-lists-search-help" className="admin-pane__note">
        {strings.admin.searchHelp}
      </p>
      <div className="admin-lists__sections">
        {sections.map((section) => (
          <SectionGroup
            key={section.id}
            section={section}
            open={open.has(section.id)}
            onToggle={() =>
              setOpen((before) => {
                const next = new Set(before);
                if (next.has(section.id)) next.delete(section.id);
                else next.add(section.id);
                return next;
              })
            }
            rounds={rounds}
            delta={delta}
            role={role}
            narrow={narrow}
            query={query.trim()}
            deps={deps}
            gone={gone}
            leaving={leaving}
            onMove={(list) => {
              setFailed(false);
              setMoving(list);
            }}
          />
        ))}
      </div>
      {moving !== null && (
        <MoveDialog
          list={moving}
          sections={sections}
          waits={waitsOf(moving, proposals)}
          narrow={narrow}
          busy={busy}
          failed={failed}
          deps={deps}
          onMove={(to) => move(moving, to)}
          onClose={() => setMoving(null)}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
