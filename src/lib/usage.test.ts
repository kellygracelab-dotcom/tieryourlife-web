import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import { memoryStore, type KeyValueStore } from "./storage";
import {
  countWith,
  createUsage,
  defaultUsageDeps,
  LEDGER_KEY,
  LEFTOVER_AFTER_MS,
  NO_USAGE,
  sendBatch,
  SESSION_GAP_MS,
  startUsage,
  usage,
  type SendOutcome,
  type UsageDeps,
} from "./usage";
import { ledgerOf, type UsageBatch } from "./usageLedger";
import { USAGE_OFF_KEY } from "./usageSwitch";

const NOON = new Date(2026, 10, 20, 12).getTime();
const ORIGIN = "https://tieryourlife.com";

function setUp(overrides: Partial<UsageDeps> = {}) {
  const store = memoryStore();
  let at = NOON;
  const sent: { batch: UsageBatch; keepalive: boolean }[] = [];
  let answer: SendOutcome = "sent";
  const deps: UsageDeps = {
    store,
    now: () => at,
    send: vi.fn(async (batch: UsageBatch, keepalive: boolean) => {
      sent.push({ batch, keepalive });
      return answer;
    }),
    hasIdentity: () => true,
    version: "2026.11.20-abc1234",
    locale: () => "ru-UA",
    origin: ORIGIN,
    ...overrides,
  };
  return {
    store,
    sent,
    deps,
    usage: createUsage(deps),
    later: (ms: number) => {
      at += ms;
    },
    answer: (next: SendOutcome) => {
      answer = next;
    },
    ledger: () => ledgerOf(JSON.parse(store.read(LEDGER_KEY) ?? "null")),
  };
}

const siteError = () => {
  const error = new TypeError("secret words");
  error.stack = `TypeError: secret words\n    at f (${ORIGIN}/assets/index-x.js:1:200)`;
  return error;
};

describe("createUsage", () => {
  it("sends a newcomer's first session as it leaves, with keepalive, and nothing twice", async () => {
    const run = setUp();
    run.usage.begin({ domain: "reddit.com", utm: "" });
    run.usage.step("first_board");
    run.usage.count("board.tier");
    await run.usage.leave();
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]!.keepalive).toBe(true);
    expect(run.sent[0]!.batch).toMatchObject({
      version: "2026.11.20-abc1234",
      locale: "ru-UA",
      active: { gap: 31, sinceFirst: 0 },
      steps: ["first_launch", "first_board"],
      features: { session: 1, "board.tier": 1 },
      sessions: 1,
      referrer: { domain: "reddit.com", utm: "" },
    });
    await run.usage.leave();
    await run.usage.send();
    expect(run.sent).toHaveLength(1);
  });

  it("treats a browser that held the site's things before as no newcomer", async () => {
    const run = setUp();
    run.store.write("tyl:boards", "[]");
    run.usage.begin(null);
    await run.usage.leave();
    expect(run.sent[0]!.batch.steps).toEqual([]);
    expect(run.sent[0]!.batch.active!.sinceFirst).toBe(365);
  });

  it("is the same session back within half an hour, and a new one after", async () => {
    const run = setUp();
    run.usage.begin(null);
    await run.usage.leave();
    run.later(SESSION_GAP_MS - 1000);
    run.usage.begin(null);
    run.usage.count("share.link");
    await run.usage.leave();
    expect(run.sent[1]!.batch.sessions).toBe(0);
    run.later(SESSION_GAP_MS + 1000);
    run.usage.begin(null);
    await run.usage.leave();
    expect(run.sent[2]!.batch.sessions).toBe(1);
  });

  it("keeps the counts for later while the browser has no account yet", async () => {
    let identity = false;
    const run = setUp({ hasIdentity: () => identity });
    run.usage.begin(null);
    await run.usage.leave();
    expect(run.sent).toHaveLength(0);
    identity = true;
    await run.usage.send();
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]!.keepalive).toBe(false);
    expect(run.sent[0]!.batch.sessions).toBe(1);
  });

  it("puts a batch back when it did not go, and sends it again", async () => {
    const run = setUp();
    run.usage.begin(null);
    run.answer("failed");
    await run.usage.leave();
    expect(run.ledger()!.stepsWaiting).toEqual(["first_launch"]);
    expect(run.ledger()!.sessions).toBe(1);
    expect(run.ledger()!.lastActiveDay).toBeNull();
    run.answer("sent");
    await run.usage.send();
    expect(run.sent[1]!.batch).toMatchObject({ steps: ["first_launch"], sessions: 1 });
    expect(run.ledger()!.stepsDone).toContain("first_launch");
  });

  it("goes quiet for the day when the server says too many, and forgets a batch it refused", async () => {
    const run = setUp();
    run.usage.begin(null);
    run.answer("tooMany");
    await run.usage.leave();
    await run.usage.send();
    expect(run.sent).toHaveLength(1);
    expect(run.ledger()!.sessions).toBe(1);
    run.later(24 * 60 * 60 * 1000);
    run.answer("refused");
    await run.usage.send();
    expect(run.sent).toHaveLength(2);
    expect(run.ledger()!.sessions).toBe(0);
  });

  it("sends one batch at a time", async () => {
    let finish: (outcome: SendOutcome) => void = () => undefined;
    const run = setUp({
      send: vi.fn(
        () =>
          new Promise<SendOutcome>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    run.usage.begin(null);
    const first = run.usage.leave();
    await run.usage.send();
    expect(run.deps.send).toHaveBeenCalledTimes(1);
    finish("sent");
    await first;
  });

  it("counts the site's own errors as a crashed session, once", async () => {
    const run = setUp();
    run.usage.begin(null);
    run.usage.crashed(siteError());
    run.usage.crashed(siteError());
    run.usage.crashed(new Error("no stack of ours"));
    await run.usage.leave();
    expect(run.sent[0]!.batch).toMatchObject({
      crashedSessions: 1,
      crashes: [
        { type: "TypeError", place: "index-x.js:1" },
        { type: "TypeError", place: "index-x.js:1" },
      ],
    });
    expect(JSON.stringify(run.sent[0]!.batch)).not.toContain("secret");
  });

  it("keeps and sends nothing of its own while turned off, and spends what waited", async () => {
    const run = setUp();
    run.usage.begin(null);
    run.usage.count("share.image");
    run.store.write(USAGE_OFF_KEY, "1");
    run.usage.count("share.link");
    run.usage.step("shared");
    run.usage.crashed(siteError());
    await run.usage.leave();
    expect(run.sent).toHaveLength(0);
    expect(run.ledger()).toMatchObject({ counts: {}, stepsWaiting: [], sessions: 0 });
    expect(run.ledger()!.stepsDone).toEqual(expect.arrayContaining(["first_launch", "shared"]));
  });

  it("starts nothing for a session begun while off, and drops nothing that was never kept", async () => {
    const store: KeyValueStore = memoryStore();
    store.write(USAGE_OFF_KEY, "1");
    const run = setUp({ store });
    run.usage.begin(null);
    await run.usage.send();
    expect(store.read(LEDGER_KEY)).toBeNull();
    expect(run.sent).toHaveLength(0);
  });

  it("starts afresh from a ledger it cannot read", async () => {
    const run = setUp();
    run.store.write(LEDGER_KEY, "{not json");
    run.usage.begin(null);
    await run.usage.leave();
    expect(run.sent[0]!.batch.steps).toEqual(["first_launch"]);
  });
});

describe("sendBatch", () => {
  const batch: UsageBatch = {
    version: "v",
    steps: [],
    features: {},
    sessions: 1,
    crashedSessions: 0,
    crashes: [],
  };

  it("posts the batch to /lists/stats and reads the answers", async () => {
    const request = vi.fn(async () => undefined) as never;
    expect(await sendBatch({ request }, batch, true)).toBe("sent");
    expect(request).toHaveBeenCalledWith("POST", "/lists/stats", { body: batch, keepalive: true });
    const failing = (error: ConstructorParameters<typeof ApiFailure>[0]) => ({
      request: vi.fn(async () => {
        throw new ApiFailure(error);
      }),
    });
    expect(
      await sendBatch(failing({ kind: "invalid", detail: null, code: "INVALID" }), batch, false),
    ).toBe("refused");
    expect(
      await sendBatch(failing({ kind: "tooManyRequests", code: "TOO_MANY" }), batch, false),
    ).toBe("tooMany");
    expect(await sendBatch(failing({ kind: "offline" }), batch, false)).toBe("failed");
  });
});

describe("startUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    countWith(NO_USAGE);
  });

  function page(referrer = "") {
    const target = new EventTarget();
    const documentTarget = new EventTarget() as EventTarget & {
      referrer: string;
      visibilityState: string;
    };
    documentTarget.referrer = referrer;
    documentTarget.visibilityState = "visible";
    return {
      target,
      document: documentTarget,
      page: {
        addEventListener: target.addEventListener.bind(target),
        document: documentTarget as unknown as Document,
        location: { href: "https://tieryourlife.com/?utm_source=play" } as Location,
      },
    };
  }

  it("counts the page's session, its errors and leaving, and sends the last visit's leftovers", async () => {
    const run = setUp();
    const at = page("https://www.reddit.com/r/x");
    const reporter = startUsage(run.deps, at.page as never);
    countWith(reporter);
    usage.count("share.link");
    usage.step("shared");

    const error = new Event("error") as Event & { error: unknown };
    error.error = siteError();
    at.target.dispatchEvent(error);
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = siteError();
    at.target.dispatchEvent(rejection);

    at.document.visibilityState = "hidden";
    at.document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(run.sent).toHaveLength(1));
    expect(run.sent[0]!.batch).toMatchObject({
      referrer: { domain: "reddit.com", utm: "play" },
      features: { session: 1, "share.link": 1 },
      steps: ["first_launch", "shared"],
      crashedSessions: 1,
    });
    expect(run.sent[0]!.batch.crashes).toHaveLength(2);

    at.document.visibilityState = "visible";
    at.document.dispatchEvent(new Event("visibilitychange"));
    usage.count("share.image");
    at.target.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(run.sent).toHaveLength(2));

    usage.count("picture.own");
    await vi.advanceTimersByTimeAsync(LEFTOVER_AFTER_MS);
    expect(run.sent).toHaveLength(3);
    expect(run.sent[2]!.batch.features).toEqual({ "picture.own": 1 });
  });

  it("counts nothing before the site starts", () => {
    countWith(NO_USAGE);
    expect(() => {
      usage.step("shared");
      usage.count("share.link");
    }).not.toThrow();
  });
});

describe("defaultUsageDeps", () => {
  it("sends through the site's client from this page's address", async () => {
    const request = vi.fn(async () => undefined) as never;
    const deps = defaultUsageDeps({ request }, () => false);
    expect(deps.origin).toBe(location.origin);
    expect(deps.hasIdentity()).toBe(false);
    expect(typeof deps.version).toBe("string");
    expect(deps.locale()).toMatch(/^[a-z]{2,3}(-[A-Z]{2})?$/);
    await deps.send(
      { version: "v", steps: [], features: {}, sessions: 0, crashedSessions: 0, crashes: [] },
      false,
    );
    expect(request).toHaveBeenCalledWith("POST", "/lists/stats", expect.anything());
  });
});
