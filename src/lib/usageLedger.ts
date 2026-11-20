/**
 * The site's usage statistics as the browser keeps them between batches
 * (proxy CONTRACT.md, Usage statistics; the same ledger as the Android app's):
 * counts since the last batch, the newcomers' steps, and two local days to say
 * how long it has been. Nothing in it names the person, and the days never
 * leave the browser: only how many days have passed does.
 */

/** In the contract's order. */
export const USAGE_STEPS = [
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
export type UsageStep = (typeof USAGE_STEPS)[number];

export type GameMode = "smart" | "king" | "bracket" | "losers";

/** Where a picture chosen from search came from, as the server counts it. */
const PICK_SOURCES = [
  "commons",
  "tmdb",
  "igdb",
  "inaturalist",
  "wikidata",
  "deezer",
  "anilist",
  "openlibrary",
  "web",
] as const;

/** Only the names the server counts; anything else it would drop. */
export type UsageFeature =
  | "session"
  | "share.image"
  | "share.link"
  | "picture.own"
  | "picture.link"
  | "board.tier"
  | "board.ranked"
  | `game.${GameMode}.${"start" | "done"}`
  | `picture.pick.${(typeof PICK_SOURCES)[number] | "other"}`
  | `picture.pos.${"1" | "2-3" | "4-10" | "11+"}`;

export const pickedFrom = (source: string | null | undefined): UsageFeature => {
  const name = (source ?? "").toLowerCase();
  return (PICK_SOURCES as readonly string[]).includes(name)
    ? (`picture.pick.${name}` as UsageFeature)
    : "picture.pick.other";
};

/** A chosen picture's place in the results, from 0. */
export const pickedAt = (index: number): UsageFeature =>
  index < 1
    ? "picture.pos.1"
    : index < 3
      ? "picture.pos.2-3"
      : index < 10
        ? "picture.pos.4-10"
        : "picture.pos.11+";

export interface UsageCrash {
  type: string;
  place: string;
}

export interface UsageReferrer {
  domain: string;
  utm: string;
}

/** Days are the browser's own local days, counted from 1970-01-01. */
export interface Ledger {
  firstDay: number;
  lastActiveDay: number | null;
  /** Sent, or passed while statistics were off: never sent again. */
  stepsDone: string[];
  stepsWaiting: string[];
  counts: Record<string, number>;
  sessions: number;
  crashedSessions: number;
  crashes: UsageCrash[];
  referrer: UsageReferrer | null;
  /** When the last session went out of sight, epoch ms: a return within half an hour is the same one. */
  leftAt: number | null;
  /** Refused for too many batches on this day: nothing more until the next. */
  quietDay: number | null;
}

export interface UsageBatch {
  version: string;
  locale?: string;
  active?: { gap: number; sinceFirst: number; firstWeek: string };
  steps: string[];
  features: Record<string, number>;
  sessions: number;
  crashedSessions: number;
  crashes: UsageCrash[];
  referrer?: UsageReferrer;
}

export const MAX_GAP = 30;
export const FIRST_OR_LONG_GAP = 31;
export const MAX_COUNT = 200;
export const MAX_CRASHES = 5;
const MAX_TYPE = 80;
const MAX_PLACE = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The browser's local day of [at]. */
export function dayOf(at: number): number {
  const date = new Date(at);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** The ISO week of a day, `2026-W47`. */
export function isoWeekOf(day: number): string {
  const date = new Date(day * DAY_MS);
  // Thursday of the same week decides its year.
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * The ledger of a browser seen for the first time. One that already holds the
 * site's things came before the statistics: its first steps are behind it,
 * and its first day is long ago, so it joins no newcomers' week.
 */
export function freshLedger(today: number, returning: boolean, on: boolean): Ledger {
  const ledger: Ledger = {
    firstDay: returning ? today - 365 : today,
    lastActiveDay: null,
    stepsDone: returning ? [...USAGE_STEPS] : [],
    stepsWaiting: [],
    counts: {},
    sessions: 0,
    crashedSessions: 0,
    crashes: [],
    referrer: null,
    leftAt: null,
    quietDay: null,
  };
  return returning ? ledger : stepped(ledger, "first_launch", on);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

/** A ledger as kept, or null for anything unreadable. */
export function ledgerOf(raw: unknown): Ledger | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kept = raw as Record<string, unknown>;
  const firstDay = whole(kept.firstDay);
  if (firstDay === null) return null;
  const counts: Record<string, number> = {};
  if (kept.counts !== null && typeof kept.counts === "object") {
    for (const [name, n] of Object.entries(kept.counts as Record<string, unknown>)) {
      const count = whole(n);
      if (count !== null && count > 0) counts[name] = count;
    }
  }
  const crashes = Array.isArray(kept.crashes)
    ? kept.crashes.flatMap((one: unknown) => {
        const crash = (one ?? {}) as Record<string, unknown>;
        return typeof crash.type === "string" && typeof crash.place === "string"
          ? [{ type: crash.type, place: crash.place }]
          : [];
      })
    : [];
  const referrer = (kept.referrer ?? null) as Record<string, unknown> | null;
  return {
    firstDay,
    lastActiveDay: whole(kept.lastActiveDay),
    stepsDone: strings(kept.stepsDone),
    stepsWaiting: strings(kept.stepsWaiting),
    counts,
    sessions: Math.max(0, whole(kept.sessions) ?? 0),
    crashedSessions: Math.max(0, whole(kept.crashedSessions) ?? 0),
    crashes: crashes.slice(-MAX_CRASHES),
    referrer:
      referrer !== null && typeof referrer.domain === "string" && typeof referrer.utm === "string"
        ? { domain: referrer.domain, utm: referrer.utm }
        : null,
    leftAt: whole(kept.leftAt),
    quietDay: whole(kept.quietDay),
  };
}

/** A step is waited with until the next batch; one passed while off is spent. */
export function stepped(ledger: Ledger, step: UsageStep, on: boolean): Ledger {
  if (ledger.stepsDone.includes(step) || ledger.stepsWaiting.includes(step)) return ledger;
  return on
    ? { ...ledger, stepsWaiting: [...ledger.stepsWaiting, step] }
    : { ...ledger, stepsDone: [...ledger.stepsDone, step] };
}

export const counted = (ledger: Ledger, name: string): Ledger => ({
  ...ledger,
  counts: { ...ledger.counts, [name]: (ledger.counts[name] ?? 0) + 1 },
});

/** A session begun: counted, with where it came from when another site sent it. */
export const sessionBegun = (ledger: Ledger, referrer: UsageReferrer | null): Ledger => ({
  ...counted(ledger, "session"),
  sessions: ledger.sessions + 1,
  referrer: referrer ?? ledger.referrer,
});

/** The session's first error makes it a crashed one; each error is kept, the newest five. */
export const crashedIn = (ledger: Ledger, crash: UsageCrash, firstInSession: boolean): Ledger => ({
  ...ledger,
  crashedSessions: ledger.crashedSessions + (firstInSession ? 1 : 0),
  crashes: [...ledger.crashes, crash].slice(-MAX_CRASHES),
});

/** Statistics turned off: what waited is not sent, and the steps it held are spent. */
export const dropped = (ledger: Ledger): Ledger => ({
  ...ledger,
  stepsDone: [...ledger.stepsDone, ...ledger.stepsWaiting],
  stepsWaiting: [],
  counts: {},
  sessions: 0,
  crashedSessions: 0,
  crashes: [],
  referrer: null,
});

/** The batch for [ledger] on [today], or null when there is nothing to say. */
export function batchOf(
  ledger: Ledger,
  today: number,
  version: string,
  locale: string | null,
): UsageBatch | null {
  const active =
    ledger.lastActiveDay === today
      ? undefined
      : {
          gap:
            ledger.lastActiveDay !== null &&
            today - ledger.lastActiveDay >= 1 &&
            today - ledger.lastActiveDay <= MAX_GAP
              ? today - ledger.lastActiveDay
              : FIRST_OR_LONG_GAP,
          sinceFirst: Math.max(0, today - ledger.firstDay),
          firstWeek: isoWeekOf(ledger.firstDay),
        };
  const features = Object.fromEntries(
    Object.entries(ledger.counts)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => [name, Math.min(n, MAX_COUNT)]),
  );
  const nothing =
    active === undefined &&
    ledger.stepsWaiting.length === 0 &&
    Object.keys(features).length === 0 &&
    ledger.sessions === 0 &&
    ledger.crashes.length === 0 &&
    ledger.referrer === null;
  if (nothing) return null;
  const sessions = Math.min(ledger.sessions, 100);
  return {
    version,
    ...(locale === null ? {} : { locale }),
    ...(active === undefined ? {} : { active }),
    steps: USAGE_STEPS.filter((step) => ledger.stepsWaiting.includes(step)),
    features,
    sessions,
    crashedSessions: Math.min(ledger.crashedSessions, sessions),
    crashes: ledger.crashes.slice(0, MAX_CRASHES),
    ...(ledger.referrer === null ? {} : { referrer: ledger.referrer }),
  };
}

/** What is left once [sent] went: anything recorded meanwhile stays for the next batch. */
export function after(ledger: Ledger, sent: UsageBatch, today: number): Ledger {
  const counts: Record<string, number> = {};
  for (const [name, n] of Object.entries(ledger.counts)) {
    const left = n - (sent.features[name] ?? 0);
    if (left > 0) counts[name] = left;
  }
  return {
    ...ledger,
    lastActiveDay: sent.active !== undefined ? today : ledger.lastActiveDay,
    stepsDone: [...new Set([...ledger.stepsDone, ...sent.steps])],
    stepsWaiting: ledger.stepsWaiting.filter((step) => !sent.steps.includes(step)),
    counts,
    sessions: Math.max(0, ledger.sessions - sent.sessions),
    crashedSessions: Math.max(0, ledger.crashedSessions - sent.crashedSessions),
    crashes: ledger.crashes.slice(sent.crashes.length),
    referrer:
      sent.referrer !== undefined &&
      ledger.referrer?.domain === sent.referrer.domain &&
      ledger.referrer.utm === sent.referrer.utm
        ? null
        : ledger.referrer,
  };
}

/**
 * An error by its name and the place in the site's own code it was thrown:
 * the file and line of the build, never the message, which may hold what
 * somebody typed. An error from somewhere else (an extension, another
 * site's script) is not the site's and is left out.
 */
export function crashOf(error: unknown, origin: string): UsageCrash | null {
  if (!(error instanceof Error)) return null;
  const stack = typeof error.stack === "string" ? error.stack : "";
  const ours = stack
    .split("\n")
    .map((line) => /(https?:\/\/[^\s)]+?):(\d+)(?::\d+)?\)?\s*$/.exec(line.trim()))
    .find((match) => match?.[1]?.startsWith(origin) === true);
  if (ours === undefined || ours === null) return null;
  const path = (ours[1] ?? "").slice(origin.length).split("?")[0] ?? "";
  const file = path.split("/").pop() || "unknown";
  const type = (error.name || "Error").slice(0, MAX_TYPE);
  return { type, place: `${file}:${ours[2]}`.slice(0, MAX_PLACE) };
}

/**
 * The site that sent somebody here, by its domain alone, and the campaign tag
 * of the address they came by; nothing when they came from the site itself,
 * or from nowhere and with no tag.
 */
export function referrerOf(referrer: string, address: string): UsageReferrer | null {
  let here: URL;
  try {
    here = new URL(address);
  } catch {
    return null;
  }
  const utm = (here.searchParams.get("utm_source") ?? "").trim().toLowerCase();
  let domain = "";
  try {
    if (referrer !== "") {
      const from = new URL(referrer);
      if (from.hostname !== here.hostname && /^https?:$/.test(from.protocol)) {
        domain = from.hostname.toLowerCase().replace(/^www\./, "");
      }
    }
  } catch {
    domain = "";
  }
  const domainOk = /^(?=.{1,80}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain);
  const utmOk = /^[a-z0-9_.-]{1,40}$/.test(utm);
  if (!domainOk && !utmOk) return null;
  return { domain: domainOk ? domain : "", utm: utmOk ? utm : "" };
}
