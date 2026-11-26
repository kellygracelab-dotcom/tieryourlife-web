import type { CoverFocus } from "./coverFocus";
import { errorOf } from "./errors";
import type { ApiClient } from "./client";
import type { EditorCredit } from "./pictureAttribution";
import { summaryOf, withRevision, type PublishRequest } from "./lists";
import type { SectionStats, ThemePair, Topic } from "./sections";
import type { FeedSort, ListSummary } from "./types";

/**
 * What the admin page asks of the backend. Every call is checked there: the
 * owner (the configured address) may do everything, an appointed moderator
 * the queues and topics (docs/sections-api.md in the app's repository). The
 * page only hides what the backend would refuse anyway.
 */
export type AdminRole = "owner" | "moderator";

/** The sections as an admin reads them: hidden, waiting and merged ones too, and who is asking. */
export interface AdminSections {
  sections: SectionStats[];
  role?: AdminRole | null;
  /** The order's version: a Save made against an older one is refused. Null for anybody not staff. */
  version?: number | null;
}

export function loadAdminSections(client: ApiClient): Promise<AdminSections> {
  return client.request<AdminSections>("GET", "/lists/sections");
}

/** The whole order and what is hidden, in one write; 409 CONFLICT when somebody saved in between. */
export function saveSectionOrder(
  client: ApiClient,
  ids: string[],
  hidden: string[],
  version: number | undefined,
): Promise<{ version: number }> {
  return client.request<{ version: number }>("PUT", "/lists/sections/order", {
    body: { ids, hidden, version },
  });
}

/** What a section is made of when it is created or changed by hand. */
export interface SectionDraft {
  name: string;
  /** Translations by locale; a language left out shows the name as typed. */
  names?: Record<string, string>;
  icon: string;
  /** A picture already uploaded to the person's own folder. */
  pictureId?: string | null;
  /** A colour picked from the picture, expanded by the backend into all five. */
  tint?: string;
  /** A pinned place in the order; left out, the backend's order places it. */
  rank?: number | null;
}

/** What an edit may change: any of a draft's fields, and whether the section is hidden. */
export type SectionChanges = Partial<SectionDraft> & {
  hidden?: boolean;
  /** Which part of the kept picture shows: null for the middle, left out it stays (CONTRACT, Cover focus). */
  pictureFocus?: CoverFocus | null;
};

export function createSection(client: ApiClient, draft: SectionDraft): Promise<SectionStats> {
  return client.request<SectionStats>("POST", "/lists/sections", { body: draft });
}

/** Only what is named changes; a built-in refuses a picture with 409 BUILT_IN. */
export function editSection(
  client: ApiClient,
  id: string,
  draft: SectionChanges,
): Promise<SectionStats> {
  return client.request<SectionStats>("PATCH", `/lists/sections/${encodeURIComponent(id)}`, {
    body: draft,
  });
}

/** Only an empty section can go; 409 NOT_EMPTY otherwise, and a built-in never. */
export function deleteSection(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/sections/${encodeURIComponent(id)}`);
}

/**
 * What a waiting proposal's name is already taken by, as staff see it: an
 * approved topic (with the section it is in), or a section. A topic wins
 * when both are; translations are not compared.
 */
export type NameClash =
  | { kind: "topic"; id: string; name: string; section: string | null; sectionName: string | null }
  | { kind: "section"; id: string; name: string };

/** A section somebody proposed, as the queue shows it. */
export interface ProposedSection extends SectionStats {
  proposerUid?: string | null;
  proposerName?: string;
  createdAt?: number;
  /** How many of the proposer's lists wait in fileUnder for it. */
  waitingLists?: number;
  /** The picture's five strongest colours, to pick another tint from. */
  palette?: string[];
  tint?: ThemePair;
  /** Null when the name is free; left out by a backend from before it said. */
  nameClash?: NameClash | null;
  /**
   * A decision made but cut short, its lists not all moved: it comes after
   * the waiting ones, with the call that finishes it.
   */
  unfinished?: boolean;
  finish?: FinishCall;
}

/** The decisions a stuck one can be finished by, each the call it was made with. */
export const FINISH_ACTIONS = [
  "approve",
  "decline",
  "merge",
  "approve-as-topic",
  "merge-into-topic",
] as const;

export interface FinishCall {
  action: (typeof FINISH_ACTIONS)[number];
  body: Record<string, unknown>;
}

/** The same call again, with the same body, which the backend resumes from where it stopped. */
export function finishDecision(
  client: ApiClient,
  id: string,
  finish: FinishCall,
): Promise<unknown> {
  if (!FINISH_ACTIONS.includes(finish.action)) {
    return Promise.reject(new Error(`Not a decision: ${String(finish.action)}`));
  }
  return client.request<unknown>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/${finish.action}`,
    { body: finish.body },
  );
}

export function loadSectionQueue(client: ApiClient): Promise<{ sections: ProposedSection[] }> {
  return client.request<{ sections: ProposedSection[] }>("GET", "/lists/sections/queue");
}

export function approveSection(
  client: ApiClient,
  id: string,
  changes: Partial<SectionDraft> = {},
): Promise<SectionStats> {
  return client.request<SectionStats>("POST", `/lists/sections/${encodeURIComponent(id)}/approve`, {
    body: changes,
  });
}

export function declineSection(client: ApiClient, id: string, note: string | null): Promise<void> {
  return client.request<void>("POST", `/lists/sections/${encodeURIComponent(id)}/decline`, {
    body: note === null ? {} : { note },
  });
}

export function mergeSection(client: ApiClient, id: string, into: string): Promise<void> {
  return client.request<void>("POST", `/lists/sections/${encodeURIComponent(id)}/merge`, {
    body: { into },
  });
}

/** Where a section proposal goes as a topic: an open section, and the name it takes there. */
export interface TopicApproval {
  section: string;
  name?: string;
  names?: Record<string, string>;
}

/**
 * A proposed section approved as a topic of an open one instead: the topic
 * takes its picture, the proposal is merged into the section, and the lists
 * waiting for it move under the topic. Refused with 409 NAME_TAKEN {id} when
 * a topic has that name (merge into it instead), and 409 SETTLED when it was decided already.
 */
export function approveSectionAsTopic(
  client: ApiClient,
  id: string,
  approval: TopicApproval,
): Promise<{ topic: Topic | null; proposal: SectionStats | null }> {
  return client.request<{ topic: Topic | null; proposal: SectionStats | null }>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/approve-as-topic`,
    { body: approval },
  );
}

/**
 * A proposal merged into an approved topic that has its name: the lists
 * waiting for it move under the topic, which keeps its own picture. Refused
 * with 400 INVALID when the topic cannot take it (not approved, or its
 * section hidden) and 409 SETTLED when it was decided already.
 */
export function mergeSectionIntoTopic(
  client: ApiClient,
  id: string,
  topic: string,
): Promise<{ topic: Topic | null; proposal: SectionStats | null }> {
  return client.request<{ topic: Topic | null; proposal: SectionStats | null }>(
    "POST",
    `/lists/sections/${encodeURIComponent(id)}/merge-into-topic`,
    { body: { topic } },
  );
}

/**
 * Whether a name is free: the section it clashes with when it is not, or
 * BAD_NAME for one no section could have.
 */
export interface NameCheck {
  free: boolean;
  id?: string;
  code?: string;
}

/** Whether a name is free, asked while it is typed: the same rule as the backend's uniqueness. */
export function checkSectionName(client: ApiClient, name: string): Promise<NameCheck> {
  return client.request<NameCheck>("GET", "/lists/sections/name-check", {
    query: { name },
  });
}

/** A proposed topic in the queue: who asked, where, and the approved ones it may be a twin of. */
export interface PendingTopic extends Topic {
  proposerName?: string;
  /**
   * First named by an anonymous list: a moderator gets no name, the owner
   * gets it with this, to mark it as hidden from the others.
   */
  proposedAnonymously?: boolean;
  requestedSection?: string | null;
  similar?: Topic[];
}

export function loadTopicQueue(client: ApiClient): Promise<{ topics: PendingTopic[] }> {
  return client.request<{ topics: PendingTopic[] }>("GET", "/lists/topics/pending");
}

export type TopicDecision =
  | { action: "approve"; section: string }
  | { action: "reject" }
  | { action: "rename"; name: string }
  | { action: "merge"; into: string };

export function decideTopic(client: ApiClient, id: string, decision: TopicDecision): Promise<void> {
  const { action, ...body } = decision;
  return client.request<void>("POST", `/lists/topics/${encodeURIComponent(id)}/${action}`, {
    body,
  });
}

/** What a topic is made of when staff make one by hand. */
export interface TopicDraft {
  name: string;
  section: string;
  /** The name in the other languages, by locale; an empty one is left out. */
  names?: Record<string, string>;
  /** A 16:10 picture already uploaded to the person's own folder. */
  pictureId?: string;
  /** Whom the picture is by, its licence and its page (CONTRACT, A topic picture's credit). */
  pictureAttribution?: EditorCredit;
}

/**
 * What an edit of a topic may change. A picture id replaces its picture,
 * null takes it away, and left out it stays as it is. A new picture sent
 * without a credit takes the old one away with it.
 */
export interface TopicChanges {
  name?: string;
  /** Only the languages that changed; "" takes a translation away. */
  names?: Record<string, string>;
  pictureId?: string | null;
  /** The picture's credit: null takes it away, left out it stays as it is. */
  pictureAttribution?: EditorCredit | null;
  /** Which part of the kept picture shows: null for the middle, left out it stays (CONTRACT, Cover focus). */
  pictureFocus?: CoverFocus | null;
}

/**
 * An approved topic made by hand, without waiting in the queue. Refused with
 * 409 NAME_TAKEN {id} and 400 BAD_PICTURE {why}, as a section's picture is;
 * 400 INVALID (detail names) and 400 BAD_ATTRIBUTION (reason) for the rest.
 */
export function createTopic(client: ApiClient, draft: TopicDraft): Promise<Topic> {
  return client.request<Topic>("POST", "/lists/topics", { body: draft });
}

export function editTopic(client: ApiClient, id: string, draft: TopicChanges): Promise<Topic> {
  return client.request<Topic>("PATCH", `/lists/topics/${encodeURIComponent(id)}`, { body: draft });
}

export function deleteTopic(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/topics/${encodeURIComponent(id)}`);
}

export interface Moderator {
  uid: string;
  name: string;
  photoUrl: string | null;
  email?: string;
  appointedAt: number;
}

export function loadModerators(client: ApiClient): Promise<{ moderators: Moderator[] }> {
  return client.request<{ moderators: Moderator[] }>("GET", "/lists/moderators");
}

export function appointModerator(
  client: ApiClient,
  who: { uid: string; name: string; photoUrl: string | null },
): Promise<void> {
  return client.request<void>("POST", `/lists/moderators/${encodeURIComponent(who.uid)}`, {
    body: { name: who.name, photoUrl: who.photoUrl },
  });
}

export function removeModerator(client: ApiClient, uid: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/moderators/${encodeURIComponent(uid)}`);
}

/** Somebody signed in who could be appointed, found by the start of their name or address. */
export interface Candidate {
  uid: string;
  name: string;
  email: string;
  photoUrl: string | null;
}

export function findCandidates(client: ApiClient, q: string): Promise<{ people: Candidate[] }> {
  return client.request<{ people: Candidate[] }>("GET", "/lists/moderators/candidates", {
    query: { q },
  });
}

/**
 * How much waits for an admin: open reports, proposals, and new lists waiting
 * for approval (absent from a backend before 26.11.2026).
 */
export interface AdminCounts {
  reports: number;
  proposals: number;
  awaitingApproval?: number;
}

/** How much waits for an admin: open reports, proposals and lists to approve. */
export function loadAdminCounts(client: ApiClient): Promise<AdminCounts> {
  return client.request<AdminCounts>("GET", "/lists/admin/counts");
}

/**
 * A new list waiting for staff before it reaches the feed (CONTRACT, Approval
 * before the feed, Danylo's decision of 26.11.2026). Its link already opens.
 */
export interface ApprovalList extends ListSummary {
  /** When it went out (ms): the queue has the longest waiting first. */
  publishedAt: number;
  underReview: boolean;
  /** Null on a list without its author's name, for anybody but the owner. */
  publishedBy: { uid: string; name: string } | null;
}

/** The lists waiting for approval, the longest waiting first (up to 300). */
export function loadApprovals(client: ApiClient): Promise<{ lists: ApprovalList[] }> {
  return client.request<{ lists: ApprovalList[] }>("GET", "/lists/admin/approvals");
}

/** Lets a waiting list into the feed; a list that waits no more is fine too. */
export function approveList(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/approve`);
}

/**
 * A published list as staff see it: under review or not, and who published
 * it, anonymous ones too. Whether it waits for a proposed section the
 * backend may say; when it does not, nobody knows here.
 */
export interface AdminList extends ListSummary {
  underReview: boolean;
  /** Null on a list without its author's name, for anybody but the owner. */
  publishedBy: { uid: string; name: string } | null;
  proposedSection?: string | null;
  proposedSectionName?: string | null;
}

/**
 * Which lists of a section: those of one topic, those without one (`none`),
 * those whose topic is not an approved one of this section (`other`), or all.
 */
export interface AdminListsQuery {
  section: string;
  topic?: string;
  sort?: FeedSort;
  after?: string | null;
}

/** One section's lists, twenty a page; 409 CURSOR_GONE when the cursor's list went. */
export function loadAdminLists(
  client: ApiClient,
  query: AdminListsQuery,
): Promise<{ lists: AdminList[]; nextCursor: string | null }> {
  return client.request<{ lists: AdminList[]; nextCursor: string | null }>(
    "GET",
    "/lists/admin/lists",
    {
      query: {
        section: query.section,
        topic: query.topic,
        sort: query.sort,
        after: query.after ?? undefined,
      },
    },
  );
}

/**
 * Where a list is moved: into an approved topic, whose section it takes, or
 * into a section without a topic. A list waiting for a proposed section stops
 * waiting.
 */
export type ListMove = { topicId: string } | { category: string; topicId: null };

export function moveList(client: ApiClient, id: string, to: ListMove): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/move`, { body: to });
}

/** Where a house list went out, or what replaced it. */
export interface HouseAnswer {
  id: string;
  topicId: string | null;
  /** The list's revision after this write: the next replace's `baseRevision`. */
  revision?: number;
}

/**
 * A board published as the house: no name, no face, no account behind it,
 * an ordinary anonymous list to everybody, staff too. The owner and the
 * moderators may; anybody else gets 403 NOT_YOURS. The body is a publish's, whose
 * `anonymous` is ignored here, and it is refused the way a publish is.
 */
export function publishAsHouse(client: ApiClient, request: PublishRequest): Promise<HouseAnswer> {
  return client
    .request<HouseAnswer>("POST", "/lists/editorial", { body: request })
    .then(withRevision);
}

/**
 * A house list replaced in place, same id and link; 403 NOT_YOURS when it is
 * not the house's. With the request's `baseRevision`, 409 LIST_CHANGED when
 * the list moved on since, and nothing is written.
 */
export function replaceHouseList(
  client: ApiClient,
  id: string,
  request: PublishRequest,
): Promise<HouseAnswer> {
  return client
    .request<HouseAnswer>("PUT", `/lists/editorial/${encodeURIComponent(id)}`, { body: request })
    .then(withRevision);
}

/**
 * A house list's words in the app's other languages, all of them at once:
 * by locale, from the text as written to its translation. 404 when the list
 * is not the house's, 403 NOT_YOURS for anybody but staff.
 */
export function saveHouseTranslations(
  client: ApiClient,
  id: string,
  translations: Partial<Record<string, Partial<Record<string, string>>>>,
): Promise<void> {
  return client.request<void>("PUT", `/lists/editorial/${encodeURIComponent(id)}/translations`, {
    body: { translations },
  });
}

/** Takes a house list down; 204 when it was gone already, too. */
export function takeDownHouseList(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/editorial/${encodeURIComponent(id)}`);
}

/**
 * The house's lists, the latest changed first, a page at a time; 409
 * CURSOR_GONE when the cursor's list went. Their covers are tidied the way
 * the feed's are, since they come from the same snapshots.
 */
export async function loadHouseLists(
  client: ApiClient,
  after: string | null = null,
): Promise<{ lists: ListSummary[]; nextCursor: string | null }> {
  const page = await client.request<{ lists?: ListSummary[]; nextCursor?: string | null }>(
    "GET",
    "/lists/editorial",
    { query: { after: after ?? undefined } },
  );
  return { lists: (page.lists ?? []).map(summaryOf), nextCursor: page.nextCursor ?? null };
}

/** A search that found nothing anywhere, as staff read it: the words, how often, and when last. */
export interface SearchMiss {
  q: string;
  count: number;
  lastAt: number;
}

/** The searches nothing answered, the most asked first (the backend's top hundred); staff only. */
export async function loadSearchMisses(client: ApiClient): Promise<SearchMiss[]> {
  const answer = await client.request<{ misses?: SearchMiss[] }>("GET", "/lists/search-misses");
  return answer.misses ?? [];
}

/** Which devices the statistics count: both, or one of them. */
export type StatsPlatform = "all" | "android" | "web";

/** The days asked for, both ends included, in UTC (YYYY-MM-DD). */
export interface StatsQuery {
  from: string;
  to: string;
  platform: StatsPlatform;
}

/** A number the backend counts; null while it cannot say (no days, no sessions). */
export type Counted = number | null;

export const TILE_NAMES = [
  "mau",
  "dauAverage",
  "newcomers",
  "d7",
  "published",
  "crashFreeUsers",
  "crashFreeSessions",
] as const;
export type TileName = (typeof TILE_NAMES)[number];

/** A figure on top: the period's, the one before's (with compare), and the change, a fraction. */
export interface StatsTile {
  value: Counted;
  previous: Counted;
  change: Counted;
}

/** A day of the period, by the event names of CONTRACT.md (Usage statistics). */
export interface StatsDay {
  day: string;
  active: number;
  /** Present when both platforms are asked for. */
  activeAndroid: number | null;
  activeWeb: number | null;
  newcomers: number;
  sessions: number;
  crashedSessions: number;
}

/** The newcomers' steps, each once per install, in their order. */
export const FUNNEL_STEPS = [
  "first_launch",
  "open_list",
  "first_board",
  "first_card",
  "full_list",
  "first_game",
  "shared",
  "signed_in",
  "published",
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface StatsCohort {
  /** The ISO week of the first launch, "2026-W47". */
  week: string;
  size: number;
  d1: Counted;
  d7: Counted;
  d30: Counted;
}

export interface StatsSearch {
  q: string;
  section: string | null;
  n: number;
  miss: number;
}

export interface StatsCut {
  value: string;
  n: number;
}

/** Firebase Auth's accounts of one kind, as counted the night before. */
export interface AccountCount {
  total: number;
  new1: number;
  active1: number;
  active7: number;
  active30: number;
}

export interface StatsCrash {
  type: string;
  place: string;
  version: string | null;
  n: number;
  /** The first and last UTC day it was counted on. */
  first: string | null;
  last: string | null;
}

/**
 * The owner's Statistics for a period (CONTRACT.md, `GET /lists/admin/stats`):
 * anonymous daily sums the backend keeps, no uid, device or address in them.
 * Read leniently: anything missing is empty, so an older or newer backend
 * still draws a screen.
 */
export interface Statistics {
  period: { from: string; to: string; todayIsPartial: boolean };
  compared: boolean;
  tiles: Record<TileName, StatsTile>;
  daily: StatsDay[];
  /** Every event and client feature (`f.<name>`) summed over the period. */
  totals: Record<string, number>;
  funnel: { step: FunnelStep; n: number }[];
  retention: StatsCohort[];
  rolling: { dau: Counted; wau: Counted; mau: Counted };
  audience: {
    versions: StatsCut[];
    languages: StatsCut[];
    regions: StatsCut[];
    accounts: {
      asOf: string | null;
      complete: boolean;
      guests: AccountCount;
      google: AccountCount;
    } | null;
  };
  top: {
    lists: { id: string; title: string | null; views: number; takes: number }[];
    topics: { id: string; name: string | null; opens: number; follows: number }[];
    sections: { id: string; opens: number }[];
    pictureSearch: StatsSearch[];
    pictureMisses: StatsSearch[];
    listSearch: StatsSearch[];
    listMisses: StatsSearch[];
    crashes: StatsCrash[];
    referrers: { domain: string; utm: string | null; n: number }[];
  };
  links: { crashlytics: string | null; playConsole: string | null; searchConsole: string | null };
  crashlytics: CrashlyticsNumbers;
}

/**
 * Google's own crash numbers for Android, ANRs included, read each night from
 * Crashlytics' BigQuery export (CONTRACT.md, Usage statistics → Crashes).
 * Waiting until the export has written its first day, or the functions may
 * read it; `failed` keeps what it had, up to `lastDay`.
 */
export type CrashlyticsState = "waiting_for_dataset" | "waiting_for_access" | "failed" | "ready";

export interface CrashlyticsCount {
  events: number;
  /** Each day's distinct installs, summed: one device on two days counts twice. */
  installDays: number;
}

export interface CrashlyticsNumbers {
  state: CrashlyticsState;
  lastDay: string | null;
  totals: { fatal: CrashlyticsCount; anr: CrashlyticsCount; nonFatal: CrashlyticsCount };
  daily: {
    day: string;
    crashes: number;
    crashInstalls: number;
    anrs: number;
    anrInstalls: number;
    nonFatal: number;
  }[];
  issues: {
    id: string;
    title: string;
    subtitle: string | null;
    kind: string;
    version: string | null;
    events: number;
    installDays: number;
    first: string | null;
    last: string | null;
  }[];
}

const CRASHLYTICS_STATES: readonly CrashlyticsState[] = [
  "waiting_for_dataset",
  "waiting_for_access",
  "failed",
  "ready",
];

type Loose = Record<string, unknown>;

const numberOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const countedOf = (value: unknown): Counted =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const textOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const objectOf = (value: unknown): Loose =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {};
const rowsOf = (value: unknown): Loose[] => (Array.isArray(value) ? value.map(objectOf) : []);

const accountOf = (value: unknown): AccountCount => {
  const one = objectOf(value);
  return {
    total: numberOf(one.total),
    new1: numberOf(one.new1),
    active1: numberOf(one.active1),
    active7: numberOf(one.active7),
    active30: numberOf(one.active30),
  };
};

const searchOf = (row: Loose): StatsSearch => ({
  q: String(row.q ?? ""),
  section: textOf(row.section),
  n: numberOf(row.n),
  miss: numberOf(row.miss),
});

const cutOf = (row: Loose): StatsCut => ({ value: String(row.value ?? ""), n: numberOf(row.n) });

/** The admin answer as the screen reads it; `{}` stands for a backend that counts nothing yet. */
export function statisticsOf(raw: unknown, query: StatsQuery): Statistics {
  const answer = objectOf(raw);
  const period = objectOf(answer.period);
  const tiles = objectOf(answer.tiles);
  const audience = objectOf(answer.audience);
  const accounts = audience.accounts;
  const top = objectOf(answer.top);
  const links = objectOf(answer.links);
  const rolling = objectOf(answer.rolling);
  const totals: Record<string, number> = {};
  for (const [event, n] of Object.entries(objectOf(answer.totals))) {
    if (typeof n === "number" && Number.isFinite(n)) totals[event] = n;
  }
  return {
    period: {
      from: textOf(period.from) ?? query.from,
      to: textOf(period.to) ?? query.to,
      todayIsPartial: period.todayIsPartial === true,
    },
    compared: answer.previous !== null && answer.previous !== undefined,
    tiles: Object.fromEntries(
      TILE_NAMES.map((name) => {
        const tile = objectOf(tiles[name]);
        return [
          name,
          {
            value: countedOf(tile.value),
            previous: countedOf(tile.previous),
            change: countedOf(tile.change),
          },
        ];
      }),
    ) as Record<TileName, StatsTile>,
    daily: rowsOf(answer.daily).map((row) => ({
      day: String(row.day ?? ""),
      active: numberOf(row.active),
      activeAndroid: countedOf(row["active.android"]),
      activeWeb: countedOf(row["active.web"]),
      newcomers: numberOf(row["step.first_launch"]),
      sessions: numberOf(row.sessions),
      crashedSessions: numberOf(row["sessions.crashed"]),
    })),
    totals,
    funnel: rowsOf(answer.funnel)
      .filter((row) => (FUNNEL_STEPS as readonly unknown[]).includes(row.step))
      .map((row) => ({ step: row.step as FunnelStep, n: numberOf(row.n) })),
    retention: rowsOf(answer.retention).map((row) => ({
      week: String(row.week ?? ""),
      size: numberOf(row.size),
      d1: countedOf(row.d1),
      d7: countedOf(row.d7),
      d30: countedOf(row.d30),
    })),
    rolling: {
      dau: countedOf(rolling.dau),
      wau: countedOf(rolling.wau),
      mau: countedOf(rolling.mau),
    },
    audience: {
      versions: rowsOf(audience.versions).map(cutOf),
      languages: rowsOf(audience.languages).map(cutOf),
      regions: rowsOf(audience.regions).map(cutOf),
      accounts:
        accounts === null || typeof accounts !== "object"
          ? null
          : {
              asOf: textOf(objectOf(accounts).asOf),
              complete: objectOf(accounts).complete !== false,
              guests: accountOf(objectOf(accounts).guests),
              google: accountOf(objectOf(accounts).google),
            },
    },
    top: {
      lists: rowsOf(top.lists).map((row) => ({
        id: String(row.id ?? ""),
        title: textOf(row.title),
        views: numberOf(row.views),
        takes: numberOf(row.takes),
      })),
      topics: rowsOf(top.topics).map((row) => ({
        id: String(row.id ?? ""),
        name: textOf(row.name),
        opens: numberOf(row.opens),
        follows: numberOf(row.follows),
      })),
      sections: rowsOf(top.sections).map((row) => ({
        id: String(row.id ?? ""),
        opens: numberOf(row.opens),
      })),
      pictureSearch: rowsOf(top.pictureSearch).map(searchOf),
      pictureMisses: rowsOf(top.pictureMisses).map(searchOf),
      listSearch: rowsOf(top.listSearch).map(searchOf),
      listMisses: rowsOf(top.listMisses).map(searchOf),
      crashes: rowsOf(top.crashes).map((row) => ({
        type: String(row.type ?? ""),
        place: String(row.place ?? ""),
        version: textOf(row.version),
        n: numberOf(row.n),
        first: textOf(row.first),
        last: textOf(row.last),
      })),
      referrers: rowsOf(top.referrers).map((row) => ({
        domain: String(row.domain ?? ""),
        utm: textOf(row.utm),
        n: numberOf(row.n),
      })),
    },
    links: {
      crashlytics: textOf(links.crashlytics),
      playConsole: textOf(links.playConsole),
      searchConsole: textOf(links.searchConsole),
    },
    crashlytics: crashlyticsOf(answer.crashlytics),
  };
}

function crashlyticsOf(raw: unknown): CrashlyticsNumbers {
  const block = objectOf(raw);
  const totals = objectOf(block.totals);
  const count = (value: unknown): CrashlyticsCount => {
    const one = objectOf(value);
    return { events: numberOf(one.events), installDays: numberOf(one.installDays) };
  };
  const state = CRASHLYTICS_STATES.find((one) => one === block.state) ?? "waiting_for_dataset";
  return {
    state,
    lastDay: textOf(block.lastDay),
    totals: {
      fatal: count(totals.FATAL),
      anr: count(totals.ANR),
      nonFatal: count(totals.NON_FATAL),
    },
    daily: rowsOf(block.daily).map((row) => ({
      day: String(row.day ?? ""),
      crashes: numberOf(row.crashes),
      crashInstalls: numberOf(row.crashInstalls),
      anrs: numberOf(row.anrs),
      anrInstalls: numberOf(row.anrInstalls),
      nonFatal: numberOf(row.nonFatal),
    })),
    issues: rowsOf(block.issues).map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      subtitle: textOf(row.subtitle),
      kind: String(row.kind ?? ""),
      version: textOf(row.version),
      events: numberOf(row.events),
      installDays: numberOf(row.installDays),
      first: textOf(row.first),
      last: textOf(row.last),
    })),
  };
}

/** Statistics with nothing counted: what a backend without the route stands for. */
export const emptyStatistics = (query: StatsQuery): Statistics => statisticsOf({}, query);

/**
 * The owner's Statistics for the days asked, with the period before to
 * compare. A backend without the route answers 404, read as nothing counted
 * rather than as a failure.
 */
export async function loadStatistics(client: ApiClient, query: StatsQuery): Promise<Statistics> {
  try {
    const answer = await client.request<unknown>("GET", "/lists/admin/stats", {
      query: { from: query.from, to: query.to, platform: query.platform, compare: "1" },
    });
    return statisticsOf(answer, query);
  } catch (reason) {
    if (errorOf(reason).kind === "notFound") return emptyStatistics(query);
    throw reason;
  }
}
