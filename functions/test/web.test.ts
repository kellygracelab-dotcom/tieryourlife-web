import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";
import { requireAppCheck } from "../src/appCheck";
import { optionalAccount, requireAccount, requireUser, type DecodedToken } from "../src/auth";
import { claimHashOf, CODE_ALPHABET, DAILY_CEILING, dayKey, MAX_BODY_BYTES } from "../src/ranking";
import { route, type WebDeps } from "../src/web";

type Data = Record<string, unknown>;

/**
 * Firestore as plain maps, speaking the handful of verbs the handlers use.
 * A server timestamp becomes the clock's "now", so `toMillis()` works on it.
 */
function memoryFirestore(clock = () => 1_000) {
  const collections = new Map<string, Map<string, Data>>();
  const table = (name: string) => {
    let docs = collections.get(name);
    if (docs === undefined) collections.set(name, (docs = new Map()));
    return docs;
  };
  const resolve = (data: Data): Data =>
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof FieldValue ? { toMillis: clock } : value,
      ]),
    );
  const snapshotOf = (id: string, data: Data | undefined) => ({
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  });
  const refOf = (name: string, id: string) => ({
    id,
    get: async () => snapshotOf(id, table(name).get(id)),
    create: async (data: Data) => {
      if (table(name).has(id)) throw Object.assign(new Error("exists"), { code: 6 });
      table(name).set(id, resolve(data));
    },
    set: async (data: Data, options?: { merge?: boolean }) => {
      const before = options?.merge === true ? (table(name).get(id) ?? {}) : {};
      table(name).set(id, { ...before, ...resolve(data) });
    },
    update: async (data: Data) => {
      table(name).set(id, { ...table(name).get(id), ...resolve(data) });
    },
    delete: async () => void table(name).delete(id),
  });
  type Ref = ReturnType<typeof refOf>;
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => refOf(name, id),
      where: (field: string, _op: "==", value: unknown) => ({
        limit: (max: number) => ({
          get: async () => {
            const docs = [...table(name)]
              .filter(([, data]) => data[field] === value)
              .slice(0, max)
              .map(([id, data]) => snapshotOf(id, data));
            return { docs, size: docs.length };
          },
        }),
      }),
    }),
    // All or nothing, as Firestore's: a create that finds its document taken
    // fails the whole commit before anything is written.
    batch: () => {
      const writes: { ref: Ref; data: Data; create: boolean; options?: { merge?: boolean } }[] = [];
      return {
        create: (ref: Ref, data: Data) => void writes.push({ ref, data, create: true }),
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) =>
          void writes.push({ ref, data, create: false, options }),
        commit: async () => {
          for (const write of writes) {
            if (write.create && (await write.ref.get()).exists) {
              throw Object.assign(new Error("exists"), { code: 6 });
            }
          }
          for (const write of writes) {
            await (write.create
              ? write.ref.create(write.data)
              : write.ref.set(write.data, write.options));
          }
        },
      };
    },
    runTransaction: async <T>(work: (transaction: unknown) => Promise<T>): Promise<T> =>
      work({
        get: (ref: Ref) => ref.get(),
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) => void ref.set(data, options),
        update: (ref: Ref, data: Data) => void ref.update(data),
        delete: (ref: Ref) => void ref.delete(),
      }),
  };
  return { db: db as unknown as Firestore, table };
}

interface Answer {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function call(
  deps: WebDeps,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const answer: Answer = { status: 0, body: undefined, headers: {} };
  const response = {
    status(code: number) {
      answer.status = code;
      return response;
    },
    json(value: unknown) {
      answer.body = value;
      return response;
    },
    setHeader(name: string, value: string) {
      answer.headers[name] = value;
      return response;
    },
    end() {
      return response;
    },
  };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const request = { method, path, body, header: (name: string) => lower[name.toLowerCase()] };
  return route(request as unknown as Request, response as unknown as Response, deps).then(
    () => answer,
  );
}

const LIST_ID = "list-0001";
const LIST: Data = {
  title: "Every A24 film, ranked",
  authorUid: "author",
  authorName: "danylo",
  category: "film_tv",
  tiers: [
    { label: "S", caption: null, colorLight: "#f00", colorDark: "#a00" },
    { label: "A", caption: null, colorLight: "#0f0", colorDark: "#0a0" },
  ],
  items: [{ title: "Ex Machina" }, { title: "Moonlight" }, { title: "Lady Bird" }],
};

const GUEST = { uid: "guest", isAnonymous: true };
const PERSON = { uid: "person", isAnonymous: false };

/** Every check passes as [who]; the code source walks a fixed sequence, then repeats it. */
function setup(who: { uid: string; isAnonymous: boolean } | null = GUEST, codes: string[] = []) {
  const store = memoryFirestore();
  store.table("publishedLists").set(LIST_ID, LIST);
  let next = 0;
  const forgotten: string[] = [];
  const sequence = codes.join("");
  const deps: WebDeps = {
    db: () => store.db,
    appCheck: async () => true,
    user: async (_request, response) => {
      if (who !== null) return who;
      response.status(401).json({ code: "UNAUTHENTICATED" });
      return null;
    },
    account: async (_request, response) => {
      if (who !== null && !who.isAnonymous) return who;
      response.status(403).json({ code: "NOT_SIGNED_IN" });
      return null;
    },
    viewer: async () => (who !== null && !who.isAnonymous ? who : null),
    forgetPictures: async (code) => void forgotten.push(code),
    random: () =>
      sequence.length === 0 ? 0 : CODE_ALPHABET.indexOf(sequence[next++ % sequence.length] ?? "2"),
  };
  return { deps, table: store.table, forgotten };
}

const ranking = (owner: string | null, anonymous: boolean, claimToken = "token") => ({
  listId: LIST_ID,
  snapshot: {
    title: "Kept",
    authorName: "danylo",
    authorPhotoUrl: null,
    category: "film_tv",
    tiers: LIST.tiers,
    items: LIST.items,
  },
  rows: [{ items: [0] }, { items: [] }],
  ownerUid: owner,
  ownerAnonymous: anonymous,
  claimHash: claimHashOf(claimToken),
  createdAt: { toMillis: () => 500 },
});

describe("POST /api/rank — Finish", () => {
  it("keeps a ranking under a new code and hands back the token that claims it", async () => {
    const { deps, table } = setup();
    const answer = await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[1], [0]] });

    assert.equal(answer.status, 201);
    const { code, claimToken } = answer.body as { code: string; claimToken: string };
    assert.match(code, /^[23456789a-z]{8}$/);
    const kept = table("rankings").get(code);
    if (kept === undefined) throw new Error("nothing was kept");
    assert.deepEqual(kept.rows, [{ items: [1] }, { items: [0] }]);
    assert.equal(kept.ownerUid, "guest");
    assert.equal(kept.ownerAnonymous, true);
    assert.equal(kept.claimHash, claimHashOf(claimToken));
    assert.equal((kept.snapshot as { title: string }).title, "Every A24 film, ranked");
    assert.equal(table("rankUsage").size, 1);
    assert.equal(typeof table("rankQuota").get("guest")?.lastWriteAt, "number");
  });

  it("refuses a body over the limit before reading anything", async () => {
    const { deps, table } = setup();
    const answer = await call(deps, "POST", "/api/rank", {
      listId: LIST_ID,
      rows: [[0]],
      pad: "x".repeat(MAX_BODY_BYTES),
    });
    assert.equal(answer.status, 413);
    assert.equal(table("rankUsage").size, 0);
  });

  it("answers 404 for a list that is gone, malformed or under review", async () => {
    const { deps, table } = setup();
    for (const listId of ["missing-list", "../x", 7]) {
      assert.equal(
        (await call(deps, "POST", "/api/rank", { listId, rows: [[0], []] })).status,
        404,
      );
    }
    table("publishedLists").set(LIST_ID, { ...LIST, underReview: true });
    assert.equal(
      (await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[0], []] })).status,
      404,
    );
  });

  it("refuses rows that do not fit the list, and counts nothing for them", async () => {
    const { deps, table } = setup();
    const answer = await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[0, 0], []] });
    assert.equal(answer.status, 400);
    assert.equal(table("rankUsage").size, 0);
  });

  it("asks a second Finish within two seconds to wait, and does not count it", async () => {
    const { deps, table } = setup();
    table("rankQuota").set("guest", { lastWriteAt: Date.now() });
    const answer = await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[0], []] });
    assert.equal(answer.status, 429);
    assert.equal(answer.headers["Retry-After"], "2");
    assert.equal(table("rankUsage").size, 0);
    assert.equal(table("rankings").size, 0);
  });

  it("stops at the daily ceiling and leaves the count where it was", async () => {
    const { deps, table } = setup();
    const today = dayKey(Date.now());
    table("rankUsage").set(today, { count: DAILY_CEILING });
    const answer = await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[0], []] });
    assert.equal(answer.status, 503);
    assert.deepEqual(answer.body, { error: "Daily limit reached", code: "DAILY_CEILING" });
    assert.equal(answer.headers["Retry-After"], "3600");
    assert.deepEqual(table("rankUsage").get(today), { count: DAILY_CEILING });
    assert.equal(table("rankings").size, 0);
  });

  it("draws another code when the first is taken, and gives up after three", async () => {
    const taken = "22222222";
    const { deps, table } = setup(GUEST, [taken, "33333333"]);
    table("rankings").set(taken, ranking("other", true));
    const answer = await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[0], []] });
    assert.equal(answer.status, 201);
    assert.equal((answer.body as { code: string }).code, "33333333");

    const full = setup(GUEST, [taken]);
    full.table("rankings").set(taken, ranking("other", true));
    const refused = await call(full.deps, "POST", "/api/rank", {
      listId: LIST_ID,
      rows: [[0], []],
    });
    assert.equal(refused.status, 503);
    // Nothing was written, so the person is not told to wait either.
    assert.equal(full.table("rankQuota").size, 0);
  });

  it("asks for a token, and a token check that fails answers before anything is read", async () => {
    const { deps, table } = setup(null);
    assert.equal(
      (await call(deps, "POST", "/api/rank", { listId: LIST_ID, rows: [[0], []] })).status,
      401,
    );
    const blocked: WebDeps = {
      ...deps,
      appCheck: async (_request, response) => {
        response.status(401).json({ code: "APP_UNVERIFIED" });
        return false;
      },
    };
    const answer = await call(blocked, "POST", "/api/rank", { listId: LIST_ID, rows: [[0], []] });
    assert.deepEqual(answer.body, { code: "APP_UNVERIFIED" });
    assert.equal(table("rankUsage").size, 0);
  });
});

describe("GET /api/rank/{code}", () => {
  it("answers the ranking, says whose it is, and is never cached", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("person", false));
    const answer = await call(deps, "GET", "/api/rank/abcdefgh");
    assert.equal(answer.status, 200);
    assert.equal(answer.headers["Cache-Control"], "no-store");
    const body = answer.body as Data;
    assert.equal(body.yours, true);
    assert.equal(body.listAvailable, true);
    assert.deepEqual(body.rows, [[0], []]);
    assert.equal(body.createdAt, 500);
  });

  it("says the list is gone when it is under review, and is nobody's for a guest", async () => {
    const { deps, table } = setup(GUEST);
    table("rankings").set("abcdefgh", ranking("guest", true));
    table("publishedLists").set(LIST_ID, { ...LIST, underReview: true });
    const body = (await call(deps, "GET", "/api/rank/abcdefgh")).body as Data;
    assert.equal(body.listAvailable, false);
    assert.equal(body.yours, false);
  });

  it("answers 404 for a code that is malformed or unknown", async () => {
    const { deps } = setup();
    assert.equal((await call(deps, "GET", "/api/rank/NOPE")).status, 404);
    assert.equal((await call(deps, "GET", "/api/rank/abcdefgh")).status, 404);
  });
});

describe("PATCH /api/rank/{code} — claim", () => {
  it("hands a guest's ranking to the account that shows its token", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("guest", true, "secret"));
    const answer = await call(deps, "PATCH", "/api/rank/abcdefgh", { claimToken: "secret" });
    assert.equal(answer.status, 200);
    assert.equal(table("rankings").get("abcdefgh")?.ownerUid, "person");
    assert.equal(table("rankings").get("abcdefgh")?.ownerAnonymous, false);
  });

  it("refuses a wrong token and one already kept by another account", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("guest", true, "secret"));
    assert.equal(
      (await call(deps, "PATCH", "/api/rank/abcdefgh", { claimToken: "wrong" })).status,
      403,
    );
    table("rankings").set("abcdefgh", ranking("someone", false, "secret"));
    const taken = await call(deps, "PATCH", "/api/rank/abcdefgh", { claimToken: "secret" });
    assert.equal(taken.status, 409);
    assert.equal(table("rankings").get("abcdefgh")?.ownerUid, "someone");
  });

  it("needs an account and a token", async () => {
    const guest = setup(GUEST);
    assert.equal(
      (await call(guest.deps, "PATCH", "/api/rank/abcdefgh", { claimToken: "x" })).status,
      403,
    );
    const person = setup(PERSON);
    assert.equal((await call(person.deps, "PATCH", "/api/rank/abcdefgh", {})).status, 400);
  });
});

describe("PUT and DELETE /api/rank/{code} — the owner's own", () => {
  it("lets the owner re-arrange, and refuses rows that do not fit", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("person", false));
    assert.equal(
      (await call(deps, "PUT", "/api/rank/abcdefgh", { rows: [[], [0, 2]] })).status,
      200,
    );
    assert.deepEqual(table("rankings").get("abcdefgh")?.rows, [{ items: [] }, { items: [0, 2] }]);
    assert.equal((await call(deps, "PUT", "/api/rank/abcdefgh", { rows: [[9], []] })).status, 400);
  });

  it("lets nobody else re-arrange or delete it", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("someone", false));
    assert.equal((await call(deps, "PUT", "/api/rank/abcdefgh", { rows: [[0], []] })).status, 403);
    assert.equal((await call(deps, "DELETE", "/api/rank/abcdefgh")).status, 403);
    assert.ok(table("rankings").has("abcdefgh"));
  });

  it("deletes the owner's ranking for good, with its share pictures", async () => {
    const { deps, table, forgotten } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("person", false));
    assert.equal((await call(deps, "DELETE", "/api/rank/abcdefgh")).status, 204);
    assert.equal(table("rankings").has("abcdefgh"), false);
    assert.deepEqual(forgotten, ["abcdefgh"]);
    assert.equal((await call(deps, "DELETE", "/api/rank/abcdefgh")).status, 404);
  });
});

describe("GET /api/me/rankings", () => {
  it("lists only the person's own rankings, newest first", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("aaaaaaaa", {
      ...ranking("person", false),
      createdAt: { toMillis: () => 1 },
    });
    table("rankings").set("bbbbbbbb", {
      ...ranking("person", false),
      createdAt: { toMillis: () => 2 },
    });
    table("rankings").set("cccccccc", ranking("someone", false));
    const answer = await call(deps, "GET", "/api/me/rankings");
    const body = answer.body as { rankings: { code: string }[]; more: boolean };
    assert.deepEqual(
      body.rankings.map((r) => r.code),
      ["bbbbbbbb", "aaaaaaaa"],
    );
    assert.equal(body.more, false);
    assert.equal(answer.headers["Cache-Control"], "no-store");
  });
});

describe("the router", () => {
  it("answers unknown addresses and methods plainly", async () => {
    const { deps } = setup(PERSON);
    assert.equal((await call(deps, "GET", "/api/nope")).status, 404);
    assert.equal((await call(deps, "GET", "/api/rank/a/b/c")).status, 404);
    assert.equal((await call(deps, "POST", "/api/me/rankings")).status, 405);
    assert.equal((await call(deps, "DELETE", "/api/rank")).status, 405);
  });

  it("deletes the ranking even when its pictures cannot be taken off the shelf", async () => {
    const { deps, table } = setup(PERSON);
    table("rankings").set("abcdefgh", ranking("person", false));
    const warned = console.warn;
    console.warn = () => undefined;
    try {
      const shelfDown: WebDeps = {
        ...deps,
        forgetPictures: async () => {
          throw new Error("bucket away");
        },
      };
      assert.equal((await call(shelfDown, "DELETE", "/api/rank/abcdefgh")).status, 204);
      assert.equal(table("rankings").has("abcdefgh"), false);
    } finally {
      console.warn = warned;
    }
  });

  it("answers HEAD on a page's picture the way it answers GET", async () => {
    const { deps } = setup();
    // A malformed id is answered without the database: the picture's own 404, not the router's.
    const head = await call(deps, "HEAD", "/og/l/bad!id.png");
    const get = await call(deps, "GET", "/og/l/bad!id.png");
    assert.equal(head.status, 404);
    assert.deepEqual(head.body, get.body);
    assert.notDeepEqual(head.body, (await call(deps, "HEAD", "/og/x/y.png")).body);
  });

  it("turns a failure inside a handler into one 503", async () => {
    const { deps } = setup(PERSON);
    const broken: WebDeps = {
      ...deps,
      db: () => {
        throw new Error("Firestore went away");
      },
    };
    const logged = console.error;
    console.error = () => undefined;
    try {
      const answer = await call(broken, "GET", "/api/rank/abcdefgh");
      assert.equal(answer.status, 503);
      assert.deepEqual(answer.body, { error: "Unavailable", code: "UNAVAILABLE" });
    } finally {
      console.error = logged;
    }
  });
});

describe("the token checks", () => {
  const request = (headers: Record<string, string | undefined>) =>
    ({
      header: (name: string) =>
        Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1],
    }) as unknown as Request;
  const response = () => {
    const seen = { status: 0, body: undefined as unknown };
    const writer = {
      status(code: number) {
        seen.status = code;
        return writer;
      },
      json(value: unknown) {
        seen.body = value;
        return writer;
      },
    };
    return { seen, writer: writer as unknown as Response };
  };
  const decode =
    (provider: string): ((token: string) => Promise<DecodedToken>) =>
    async (token) => {
      if (token !== "good") throw new Error("bad token");
      return { uid: "u1", firebase: { sign_in_provider: provider } };
    };

  it("requireUser reads a Bearer token and names a guest as one", async () => {
    const out = response();
    assert.deepEqual(
      await requireUser(request({ Authorization: "Bearer good" }), out.writer, decode("anonymous")),
      { uid: "u1", isAnonymous: true },
    );
    for (const header of [{}, { Authorization: "Basic good" }, { Authorization: "Bearer bad" }]) {
      const refused = response();
      assert.equal(await requireUser(request(header), refused.writer, decode("google.com")), null);
      assert.equal(refused.seen.status, 401);
      assert.equal((refused.seen.body as { code: string }).code, "UNAUTHENTICATED");
    }
  });

  it("requireAccount turns a guest away with 403, a person through", async () => {
    const guest = response();
    assert.equal(
      await requireAccount(
        request({ Authorization: "Bearer good" }),
        guest.writer,
        decode("anonymous"),
      ),
      null,
    );
    assert.equal(guest.seen.status, 403);
    const person = response();
    assert.deepEqual(
      await requireAccount(
        request({ Authorization: "Bearer good" }),
        person.writer,
        decode("google.com"),
      ),
      { uid: "u1", isAnonymous: false },
    );
  });

  it("optionalAccount is nobody for a guest, a stale token or none, and refuses nothing", async () => {
    assert.equal(await optionalAccount(request({}), decode("google.com")), null);
    assert.equal(
      await optionalAccount(request({ authorization: "Bearer bad" }), decode("google.com")),
      null,
    );
    assert.equal(
      await optionalAccount(request({ authorization: "Bearer good" }), decode("anonymous")),
      null,
    );
    assert.deepEqual(
      await optionalAccount(request({ authorization: "Bearer good" }), decode("google.com")),
      {
        uid: "u1",
        isAnonymous: false,
      },
    );
  });

  it("requireAppCheck answers APP_UNVERIFIED for a missing or a refused token", async () => {
    const verify = async (token: string) => {
      if (token !== "good") throw new Error("refused");
    };
    assert.equal(
      await requireAppCheck(request({ "X-Firebase-AppCheck": "good" }), response().writer, verify),
      true,
    );
    for (const header of [{}, { "X-Firebase-AppCheck": "bad" }]) {
      const out = response();
      assert.equal(await requireAppCheck(request(header), out.writer, verify), false);
      assert.equal(out.seen.status, 401);
      assert.equal((out.seen.body as { code: string }).code, "APP_UNVERIFIED");
    }
  });
});
