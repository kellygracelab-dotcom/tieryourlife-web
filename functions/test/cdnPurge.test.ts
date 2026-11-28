import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import {
  LEASE_MS,
  PURGE_MARK,
  SKEW_MS,
  HostingError,
  carryOutPurges,
  claim,
  cdnKeeps,
  copiesOf,
  done,
  forgetKeptForTests,
  markedConfig,
  next,
  onPurgeRequest,
  publishedKept,
  purgeCdn,
  readCdnState,
  type CdnState,
  type CdnStore,
  type Claim,
  type HostingCall,
  type PurgeRequests,
  type Step,
} from "../src/cdnPurge";
import { PUBLISHED_KEPT, PUBLISHED_ORIGINAL, sendPicture, type SmallCopies } from "../src/pictures";

const T = 1_800_000_000_000;
const fresh = (): CdnState => readCdnState(undefined);

/** config/webCdn in memory, each step whole as a transaction makes it. */
function memoryStore(clock: { now: number }, state: CdnState = fresh()) {
  const box = { state };
  const store: CdnStore = {
    claim: async (deletedAt) => {
      const [after, result] = claim(box.state, deletedAt, clock.now);
      box.state = after;
      return result;
    },
    next: async () => {
      const [after, step] = next(box.state, clock.now);
      box.state = after;
      return step;
    },
    done: async (startedAt, ok) => {
      box.state = done(box.state, startedAt, ok, clock.now);
    },
  };
  return { store, box };
}

/**
 * Hosting's API as far as a purge goes: one live version with its config and
 * files, new versions made, populated, finalized and released.
 */
function fakeHosting(options: { lose?: boolean; deployDuring?: "populate" | "release" } = {}) {
  const versions = new Map<
    string,
    { config: Record<string, unknown>; files: Record<string, string>; status: string }
  >();
  versions.set("sites/tieryourlife/versions/v1", {
    config: {
      headers: [{ glob: "/", headers: { Link: "</api/home>" } }],
      rewrites: [{ glob: "/img/**", run: { serviceId: "web" } }],
    },
    files: { "/index.html": "h1", "/assets/a.js": "h2" },
    status: "FINALIZED",
  });
  const releases: string[] = ["sites/tieryourlife/versions/v1"];
  const calls: string[] = [];
  let made = 0;
  const deployOther = () => {
    versions.set("sites/tieryourlife/versions/cd", {
      config: { headers: [] },
      files: { "/index.html": "h9" },
      status: "FINALIZED",
    });
    releases.unshift("sites/tieryourlife/versions/cd");
  };
  const versionOf = (name: string) => ({ name, config: versions.get(name)?.config });
  const call: HostingCall = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    calls.push(`${method} ${path.split("?")[0]}`);
    const answer = (value: unknown) => value as T;
    if (method === "GET" && path === "/sites/tieryourlife/channels/live") {
      return answer({ release: { version: versionOf(releases[0]!) } });
    }
    if (method === "GET" && path.startsWith("/sites/tieryourlife/channels/live/releases")) {
      return answer({
        releases: releases.slice(0, 2).map((name) => ({ version: versionOf(name) })),
      });
    }
    if (method === "GET" && path.includes("/files?")) {
      const name = path.slice(1, path.indexOf("/files?"));
      return answer({
        files: Object.entries(versions.get(name)?.files ?? {}).map(([p, hash]) => ({
          path: p,
          hash,
        })),
      });
    }
    if (method === "POST" && path === "/sites/tieryourlife/versions") {
      const name = `sites/tieryourlife/versions/m${++made}`;
      versions.set(name, {
        config: (body as { config: Record<string, unknown> }).config,
        files: {},
        status: "CREATED",
      });
      return answer({ name });
    }
    if (method === "POST" && path.endsWith(":populateFiles")) {
      const name = path.slice(1, -":populateFiles".length);
      const files = (body as { files: Record<string, string> }).files;
      Object.assign(versions.get(name)!.files, files);
      if (options.deployDuring === "populate") {
        options.deployDuring = undefined;
        deployOther();
      }
      return answer(options.lose ? { uploadRequiredHashes: ["h2"] } : {});
    }
    if (method === "PATCH") {
      versions.get(path.slice(1).split("?")[0]!)!.status = "FINALIZED";
      return answer({});
    }
    if (method === "POST" && path.startsWith("/sites/tieryourlife/releases?versionName=")) {
      const name = decodeURIComponent(path.split("versionName=")[1]!);
      assert.equal(versions.get(name)?.status, "FINALIZED");
      if (options.deployDuring === "release") {
        options.deployDuring = undefined;
        deployOther();
      }
      releases.unshift(name);
      return answer({});
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { call, versions, releases, calls };
}

describe("a takedown's cards' copies", () => {
  it("are the 200 and 400 copies of each deleted file in a list's folder, other lists' included", () => {
    assert.deepEqual(copiesOf(["published/list-1/p1", "published/list-2/list-1-p1"]), [
      "published/list-1/w200/p1",
      "published/list-1/w400/p1",
      "published/list-2/w200/list-1-p1",
      "published/list-2/w400/list-1-p1",
    ]);
    assert.deepEqual(copiesOf(["users/u1/p", "published/list-1", 7, "published/a/b/c"]), []);
    assert.deepEqual(copiesOf(undefined), []);
  });
});

describe("deletions that come together share a purge, and none is left out", () => {
  it("the first runs, the next ones wait on it, one before a purge that started after it is covered", () => {
    let state = fresh();
    let result: Claim;
    [state, result] = claim(state, T, T + 500);
    assert.equal(result, "run");
    assert.equal(state.leaseUntil, T + 500 + LEASE_MS);
    [state, result] = claim(state, T + 100, T + 600);
    assert.equal(result, "queued");
    assert.equal(state.wantedAt, T + 100);

    // The runner waits out the clocks' margin, then starts.
    let step: Step;
    [state, step] = next(state, T + 700);
    assert.deepEqual(step, { run: false, waitMs: T + 100 + SKEW_MS + 1 - (T + 700) });
    [state, step] = next(state, T + 3_000);
    assert.deepEqual(step, { run: true, startedAt: T + 3_000 });

    // Deleted before the start: covered while it runs and after it went through.
    [, result] = claim(state, T + 200, T + 3_500);
    assert.equal(result, "covered");
    state = done(state, T + 3_000, true, T + 9_000);
    assert.equal(state.canPurge, true);
    [, result] = claim(state, T + 200, T + 9_500);
    assert.equal(result, "covered");

    // Deleted while it ran: one more purge, after which the lease goes.
    [state, result] = claim(state, T + 4_000, T + 9_600);
    assert.equal(result, "queued");
    [state, step] = next(state, T + 9_700);
    assert.deepEqual(step, { run: true, startedAt: T + 9_700 });
    state = done(state, T + 9_700, true, T + 15_000);
    [state, step] = next(state, T + 15_000);
    assert.deepEqual(step, { run: false, waitMs: 0 });
    assert.equal(state.leaseUntil, 0);
  });

  it("a failed purge is wanted again, stops keeping pictures long, and its event runs it again", () => {
    let state = { ...fresh(), canPurge: true };
    [state] = claim(state, T, T);
    let step: Step;
    [state, step] = next(state, T + 5_000);
    assert.equal(step.run, true);
    state = done(state, T + 5_000, false, T + 8_000);
    assert.equal(state.failingSince, T + 8_000);
    assert.equal(state.leaseUntil, 0);
    assert.equal(cdnKeeps(state), false);
    // Its own event tried again is not "covered" by the purge that failed.
    let result: Claim;
    [state, result] = claim(state, T, T + 60_000);
    assert.equal(result, "run");
    [state, step] = next(state, T + 60_000);
    assert.equal(step.run, true);
    state = done(state, T + 60_000, true, T + 70_000);
    assert.equal(state.failingSince, null);
    assert.equal(cdnKeeps(state), true);
  });

  it("a runner that died lets the next event take over once its lease is over", () => {
    let state = fresh();
    [state] = claim(state, T, T);
    [state] = next(state, T + 3_000);
    let result: Claim;
    [, result] = claim(state, T + 500, T + 30_000);
    assert.equal(result, "covered");
    [state, result] = claim(state, T + 500, T + 3_000 + LEASE_MS + 1);
    assert.equal(result, "run");
  });

  it("keeps long only after a purge went through, while none fails and the switch is on", () => {
    assert.equal(cdnKeeps(fresh()), false);
    assert.equal(cdnKeeps(readCdnState({ canPurge: true })), true);
    assert.equal(cdnKeeps(readCdnState({ canPurge: true, keep: false })), false);
    assert.equal(cdnKeeps(readCdnState({ canPurge: true, failingSince: T })), false);
  });
});

describe("a purge releases the live version again with one header changed", () => {
  it("the same files, the same config but the mark, released on top", async () => {
    const hosting = fakeHosting();
    const purged = await purgeCdn(hosting.call, () => T);
    assert.deepEqual(purged, { version: "sites/tieryourlife/versions/m1", rounds: 1 });
    const made = hosting.versions.get("sites/tieryourlife/versions/m1")!;
    assert.deepEqual(made.files, { "/index.html": "h1", "/assets/a.js": "h2" });
    assert.deepEqual(
      made.config,
      markedConfig(hosting.versions.get("sites/tieryourlife/versions/v1")!.config, T),
    );
    assert.deepEqual((made.config as { rewrites: unknown }).rewrites, [
      { glob: "/img/**", run: { serviceId: "web" } },
    ]);
    assert.deepEqual(hosting.releases, [
      "sites/tieryourlife/versions/m1",
      "sites/tieryourlife/versions/v1",
    ]);

    // The next purge changes the mark, never adds a second one.
    await purgeCdn(hosting.call, () => T + 1);
    const again = hosting.versions.get("sites/tieryourlife/versions/m2")!.config as {
      headers: { glob: string; headers: Record<string, string> }[];
    };
    assert.deepEqual(
      again.headers.filter((one) => one.glob === PURGE_MARK),
      [{ glob: PURGE_MARK, headers: { "X-Cdn-Purge": String(T + 1) } }],
    );
    assert.equal(again.headers.length, 2);
  });

  it("never takes back a deploy that lands meanwhile", async () => {
    const before = fakeHosting({ deployDuring: "populate" });
    await purgeCdn(before.call, () => T);
    assert.equal(before.releases[0], "sites/tieryourlife/versions/m2");
    assert.deepEqual(before.versions.get("sites/tieryourlife/versions/m2")!.files, {
      "/index.html": "h9",
    });

    const between = fakeHosting({ deployDuring: "release" });
    const purged = await purgeCdn(between.call, () => T);
    assert.equal(purged.rounds, 2);
    // The deploy's files are what is live in the end, purged on top.
    assert.deepEqual(between.versions.get(between.releases[0]!)!.files, { "/index.html": "h9" });
  });

  it("fails without releasing when Hosting would need the files again", async () => {
    const hosting = fakeHosting({ lose: true });
    await assert.rejects(
      purgeCdn(hosting.call, () => T),
      /lost 1 files/,
    );
    assert.deepEqual(hosting.releases, ["sites/tieryourlife/versions/v1"]);
  });
});

describe("a takedown's request", () => {
  const depsFor = (
    clock: { now: number },
    store: CdnStore,
    call: HostingCall,
    removed: string[] = [],
  ) => ({
    store,
    call,
    copies: { remove: async (path: string) => void removed.push(path) },
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.now += ms;
    },
    logs: [] as Record<string, unknown>[],
    log(entry: Record<string, unknown>) {
      this.logs.push(entry);
    },
  });

  it("removes the cards' copies, purges once for takedowns that come together, and logs how long it took", async () => {
    const clock = { now: T };
    const { store, box } = memoryStore(clock);
    const hosting = fakeHosting();
    const removed: string[] = [];
    const deps = depsFor(clock, store, hosting.call, removed);
    assert.equal(await onPurgeRequest(T, ["published/list-1/p1"], deps), "run");
    assert.deepEqual(removed, ["published/list-1/w200/p1", "published/list-1/w400/p1"]);
    assert.equal(hosting.releases.length, 2);
    assert.equal(box.state.canPurge, true);
    // Taken down with the first, their requests come after its purge started.
    assert.equal(await onPurgeRequest(T - 10, [], deps), "covered");
    assert.equal(hosting.releases.length, 2);
    assert.equal(deps.logs.length, 1);
    assert.equal(deps.logs[0]?.message, "CDN purge");
    assert.equal(deps.logs[0]?.waitedMs, SKEW_MS + 1);
  });

  it("tries a failed purge again twice, then marks it failing and throws", async () => {
    const clock = { now: T };
    const { store, box } = memoryStore(clock, { ...fresh(), canPurge: true });
    let calls = 0;
    const hosting = fakeHosting({ lose: true });
    const counting: HostingCall = (method, path, body) => {
      if (method === "POST" && path === "/sites/tieryourlife/versions") calls++;
      return hosting.call(method, path, body);
    };
    const deps = depsFor(clock, store, counting);
    await assert.rejects(onPurgeRequest(T, [], deps), /lost 1 files/);
    assert.equal(calls, 3);
    assert.deepEqual(
      deps.logs.map((entry) => entry.message),
      ["CDN purge failed, trying again", "CDN purge failed, trying again"],
    );
    assert.notEqual(box.state.failingSince, null);
    assert.equal(cdnKeeps(box.state), false);
    assert.equal(box.state.leaseUntil, 0);
  });

  it("goes through when a later try does", async () => {
    const clock = { now: T };
    const { store, box } = memoryStore(clock);
    const hosting = fakeHosting();
    let failOnce = true;
    const flaky: HostingCall = (method, path, body) => {
      if (failOnce && method === "POST" && path === "/sites/tieryourlife/versions") {
        failOnce = false;
        return Promise.reject(new HostingError(503, "Hosting POST: 503"));
      }
      return hosting.call(method, path, body);
    };
    assert.equal(await onPurgeRequest(T, [], depsFor(clock, store, flaky)), "run");
    assert.equal(box.state.canPurge, true);
    assert.equal(box.state.failingSince, null);
  });

  it("does not try again what Hosting refuses, and keeps pictures a minute", async () => {
    const clock = { now: T };
    const { store, box } = memoryStore(clock, { ...fresh(), canPurge: true });
    const refuse: HostingCall = async () => {
      throw new HostingError(403, "Hosting GET: 403 permission denied");
    };
    const deps = depsFor(clock, store, refuse);
    assert.equal(await onPurgeRequest(T, [], deps), "refused");
    assert.equal(cdnKeeps(box.state), false);
    assert.equal(deps.logs[0]?.message, "CDN purge refused");
  });
});

describe("the requests waiting for POST /api/cdn-purge", () => {
  const requestsOf = (waiting: { id: string; at: number; paths: unknown }[]) => {
    const done: string[] = [];
    const requests: PurgeRequests = {
      pending: async () => waiting.filter((one) => !done.includes(one.id)),
      carriedOut: async (ids) => void done.push(...ids),
    };
    return { requests, done };
  };
  const depsOf = (
    clock: { now: number },
    store: CdnStore,
    call: HostingCall,
    removed: string[],
  ) => ({
    store,
    call,
    copies: { remove: async (path: string) => void removed.push(path) },
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.now += ms;
    },
    log: () => undefined,
  });

  it("are carried out together, by the newest takedown's time, and then not again", async () => {
    const clock = { now: T + 5_000 };
    const { store, box } = memoryStore(clock);
    const hosting = fakeHosting();
    const removed: string[] = [];
    const { requests, done } = requestsOf([
      { id: "a", at: T, paths: ["published/list-1/p1"] },
      { id: "b", at: T + 1_000, paths: ["published/list-2/p2"] },
    ]);
    const deps = depsOf(clock, store, hosting.call, removed);
    assert.deepEqual(await carryOutPurges(requests, deps), { waiting: 2, result: "run" });
    assert.equal(box.state.wantedAt, T + 1_000);
    assert.equal(hosting.releases.length, 2);
    assert.deepEqual(done, ["a", "b"]);
    assert.equal(removed.length, 4);
    // Asked again, or by anybody: nothing waits, nothing is purged.
    assert.deepEqual(await carryOutPurges(requests, deps), { waiting: 0, result: "none" });
    assert.equal(hosting.releases.length, 2);
  });

  it("stay waiting when Hosting refuses", async () => {
    const clock = { now: T };
    const { store } = memoryStore(clock);
    const refuse: HostingCall = async () => {
      throw new HostingError(403, "denied");
    };
    const { requests, done } = requestsOf([{ id: "a", at: T, paths: [] }]);
    assert.deepEqual(await carryOutPurges(requests, depsOf(clock, store, refuse, [])), {
      waiting: 1,
      result: "refused",
    });
    assert.deepEqual(done, []);
  });
});

describe("a card's copy kept next to its picture", () => {
  const original = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const webp = Buffer.from("RIFF0000WEBPsmall", "latin1");

  async function ask(stored: Map<string, Buffer>, copies: SmallCopies, segments: string[]) {
    const answer: { status: number; body?: unknown } = { status: 0 };
    const response = {
      status(code: number) {
        answer.status = code;
        return response;
      },
      json: (body: unknown) => {
        answer.body = body;
        return response;
      },
      send: (body: unknown) => {
        answer.body = body;
        return response;
      },
      setHeader: () => response,
    };
    const reads: string[] = [];
    let shrunk = 0;
    await sendPicture(
      response as unknown as Response,
      segments,
      {
        read: async (path) => {
          reads.push(path);
          return stored.get(path) ?? null;
        },
        shrink: async () => {
          shrunk++;
          return webp;
        },
        copies,
      },
      async () => false,
    );
    return { ...answer, reads, shrunk };
  }

  const bucket = (
    stored: Map<string, Buffer>,
    onSave: () => void = () => undefined,
  ): SmallCopies => ({
    exists: async (path) => stored.has(path),
    save: async (path, bytes) => {
      stored.set(path, bytes);
      onSave();
    },
    remove: async (path) => void stored.delete(path),
  });

  it("is made once, kept, and given after without the original read or shrunk", async () => {
    const stored = new Map([["published/list-0001/p1", original]]);
    const first = await ask(stored, bucket(stored), ["200", "published", "list-0001", "p1"]);
    assert.equal(first.status, 200);
    assert.equal(first.shrunk, 1);
    assert.deepEqual(stored.get("published/list-0001/w200/p1"), webp);
    const again = await ask(stored, bucket(stored), ["200", "published", "list-0001", "p1"]);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, webp);
    assert.equal(again.shrunk, 0);
    assert.deepEqual(again.reads, ["published/list-0001/w200/p1"]);
  });

  it("is never given once its picture is gone, and goes at once when made as it went", async () => {
    const stored = new Map([["published/list-0001/w400/p1", webp]]);
    const gone = await ask(stored, bucket(stored), ["400", "published", "list-0001", "p1"]);
    assert.equal(gone.status, 404);

    const racing = new Map([["published/list-0001/p2", original]]);
    // The takedown deletes the picture while its copy is being saved.
    const copies = bucket(racing, () => racing.delete("published/list-0001/p2"));
    const made = await ask(racing, copies, ["400", "published", "list-0001", "p2"]);
    assert.equal(made.status, 200);
    assert.equal(racing.has("published/list-0001/w400/p2"), false);
  });

  it("is not made for the picture as it is, which is sent whole", async () => {
    const stored = new Map([["published/list-0001/p1", original]]);
    const whole = await ask(stored, bucket(stored), ["original", "published", "list-0001", "p1"]);
    assert.deepEqual(whole.body, original);
    assert.equal(stored.size, 1);
  });
});

describe("a published picture's cache header", () => {
  beforeEach(() => forgetKeptForTests());

  async function header(segments: string[], kept: boolean): Promise<string | undefined> {
    const headers: Record<string, string> = {};
    const response = {
      status: () => response,
      json: () => response,
      send: () => response,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
        return response;
      },
    };
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await sendPicture(
      response as unknown as Response,
      segments,
      { read: async () => png, shrink: async (bytes) => bytes },
      async () => kept,
    );
    return headers["Cache-Control"];
  }

  it("is kept a day while purges work, a minute otherwise; a catalogue's copy keeps its day", async () => {
    const card = ["200", "published", "p1fPGC8cOfrSy9Ds9GF8", "w-abc"];
    const original = ["original", "published", "p1fPGC8cOfrSy9Ds9GF8", "w-abc"];
    assert.equal(await header(card, true), PUBLISHED_KEPT);
    assert.equal(await header(original, true), PUBLISHED_KEPT);
    assert.equal(await header(card, false), PUBLISHED_ORIGINAL);
    assert.equal(await header(original, false), PUBLISHED_ORIGINAL);
    assert.match(PUBLISHED_KEPT, /s-maxage=86400/);
    assert.match(
      (await header(["400", "published", "catalogue", "w-abc"], false)) ?? "",
      /s-maxage=86400/,
    );
  });

  it("reads config/webCdn at most every thirty seconds, and a minute when it cannot", async () => {
    let reads = 0;
    let data: Record<string, unknown> | undefined = { canPurge: true };
    const db = (() => ({
      doc: () => ({
        get: async () => {
          reads++;
          if (data === undefined) throw new Error("away");
          return { data: () => data };
        },
      }),
    })) as unknown as () => Firestore;
    assert.equal(await publishedKept(db, T), true);
    data = { canPurge: true, keep: false };
    assert.equal(await publishedKept(db, T + 29_000), true);
    assert.equal(await publishedKept(db, T + 31_000), false);
    data = undefined;
    assert.equal(await publishedKept(db, T + 62_000), false);
    assert.equal(reads, 3);
  });
});
