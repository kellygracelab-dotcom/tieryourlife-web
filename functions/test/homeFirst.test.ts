import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/https";
import type { Response } from "express";
import {
  FEED_PAGE_SIZE,
  FRESH_DAYS,
  forgetHomeFirstForTests,
  freshRow,
  guestSummary,
  HOME_FIRST_CACHE,
  HOME_FIRST_MS,
  homeFirst,
  publicMediaJson,
  readHomeFirst,
  type HomeFirst,
} from "../src/homeFirst";
import { route, type WebDeps } from "../src/web";

type Data = Record<string, unknown>;
const NOW = Date.UTC(2026, 10, 27, 12);
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => Timestamp.fromMillis(ms);
const valueOf = (value: unknown): unknown =>
  value instanceof Timestamp ? value.toMillis() : value;

/**
 * Enough of Firestore for the first screen's reads: where (==, >=, in),
 * orderBy, startAfter, limit, count, getAll. Ties keep the order the
 * documents were put in, as document ids would.
 */
function fakeDb(tables: Record<string, [string, Data][]>) {
  const snapshotOf = (id: string, data: Data | undefined) => ({
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  });
  type Snap = ReturnType<typeof snapshotOf>;
  interface Query {
    filters: ((data: Data) => boolean)[];
    orders: [string, "asc" | "desc"][];
    after: string | null;
    max: number;
  }
  const run = (name: string, query: Query): Snap[] => {
    const rows = (tables[name] ?? []).filter(([, data]) =>
      query.filters.every((keep) => keep(data)),
    );
    const sorted = rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        for (const [field, direction] of query.orders) {
          const a = valueOf(left.row[1][field]) as number;
          const b = valueOf(right.row[1][field]) as number;
          if (a !== b) return direction === "desc" ? b - a : a - b;
        }
        return left.index - right.index;
      })
      .map(({ row }) => row);
    const from = query.after === null ? 0 : sorted.findIndex(([id]) => id === query.after) + 1;
    return sorted.slice(from, from + query.max).map(([id, data]) => snapshotOf(id, data));
  };
  const builder = (name: string, query: Query) => ({
    where: (field: string, op: string, value: unknown) =>
      builder(name, {
        ...query,
        filters: [
          ...query.filters,
          (data: Data) => {
            const have = valueOf(data[field]);
            if (op === "==") return have === valueOf(value);
            if (op === ">=") return typeof have === "number" && have >= (valueOf(value) as number);
            if (op === "in") return (value as unknown[]).includes(have);
            throw new Error(`no ${op}`);
          },
        ],
      }),
    orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
      builder(name, { ...query, orders: [...query.orders, [field, direction]] }),
    startAfter: (doc: Snap) => builder(name, { ...query, after: doc.id }),
    limit: (max: number) => builder(name, { ...query, max }),
    get: async () => ({ docs: run(name, query) }),
    count: () => ({
      get: async () => ({ data: () => ({ count: run(name, { ...query, max: Infinity }).length }) }),
    }),
    doc: (id: string) => ({
      get: async () => snapshotOf(id, (tables[name] ?? []).find(([one]) => one === id)?.[1]),
    }),
  });
  const db = {
    collection: (name: string) =>
      builder(name, { filters: [], orders: [], after: null, max: Infinity }),
    getAll: async (...refs: { get: () => Promise<Snap> }[]) =>
      Promise.all(refs.map((ref) => ref.get())),
  };
  return db as unknown as Firestore;
}

const STORAGE = "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/";
const stored = (path: string) => `${STORAGE}${encodeURIComponent(path)}?alt=media`;
const site = (path: string) => `https://tieryourlife.com/img/original/${path}`;

function list(id: string, over: Data = {}): [string, Data] {
  return [
    id,
    {
      title: `List ${id}`,
      authorUid: "u1",
      authorName: "Ann",
      authorPhotoUrl: null,
      category: "film_tv",
      itemCount: 10,
      coverImageUrl: stored(`published/${id}/cover`),
      previewImages: [],
      tierColors: ["#f00"],
      tiers: [{}, {}],
      items: Array.from({ length: 10 }, (_, n) => ({
        imageUrl: stored(`published/${id}/p${n}`),
        tierIndex: n % 3,
      })),
      takeCount: 0,
      updatedAt: at(NOW - DAY),
      publishedAt: at(NOW - DAY),
      ...over,
    },
  ];
}

describe("Community's first screen", () => {
  it("reads Popular as the feed does: most taken first, then newest, past hidden and waiting lists", async () => {
    const lists = [
      list("a", { takeCount: 1, updatedAt: at(NOW - 3 * DAY) }),
      list("b", { takeCount: 5 }),
      list("c", { takeCount: 1, updatedAt: at(NOW - DAY) }),
      list("held", { takeCount: 9, underReview: true }),
      list("waits", { takeCount: 8, awaitingApproval: true }),
      list("approved", { takeCount: 0, awaitingApproval: false, updatedAt: at(NOW - 9 * DAY) }),
    ];
    const answer = await readHomeFirst(fakeDb({ publishedLists: lists }), NOW);
    assert.deepEqual(
      answer.popular.lists.map((one) => one.id),
      ["b", "c", "a", "approved"],
    );
    assert.equal(answer.popular.nextCursor, null);
  });

  it("fills Popular's page past hidden lists and carries on after its last list", async () => {
    const lists = [
      ...Array.from({ length: 8 }, (_, n) => list(`h${n}`, { takeCount: 100, underReview: true })),
      ...Array.from({ length: 30 }, (_, n) => list(`l${n}`, { takeCount: 50 - n })),
    ];
    const answer = await readHomeFirst(fakeDb({ publishedLists: lists }), NOW);
    assert.equal(answer.popular.lists.length, FEED_PAGE_SIZE);
    assert.equal(answer.popular.lists[0]?.id, "l0");
    assert.equal(answer.popular.nextCursor, `l${FEED_PAGE_SIZE - 1}`);
  });

  it("puts people's newest lists in the row as the proxy does: rules, bans, a turn for each author", async () => {
    const pictures = (id: string, count: number, pictured: number) =>
      Array.from({ length: count }, (_, n) => ({
        imageUrl: n < pictured ? stored(`published/${id}/p${n}`) : null,
      }));
    const lists = [
      list("ann1", { publishedAt: at(NOW - 1000) }),
      list("ann2", { publishedAt: at(NOW - 2000) }),
      list("ann3", { publishedAt: at(NOW - 3000) }),
      list("ann4", { publishedAt: at(NOW - 4000) }),
      list("bob1", { authorUid: "u2", publishedAt: at(NOW - 2500) }),
      list("house", { authorUid: "tyl-editorial", publishedAt: at(NOW - 10) }),
      list("nameless", { anonymous: true, publishedAt: at(NOW - 10) }),
      list("waits", { awaitingApproval: true, publishedAt: at(NOW - 10) }),
      list("held", { underReview: true, publishedAt: at(NOW - 10) }),
      list("short", { items: pictures("short", 7, 7), publishedAt: at(NOW - 10) }),
      list("bare", { items: pictures("bare", 10, 7), publishedAt: at(NOW - 10) }),
      list("collage", {
        coverImageUrl: null,
        previewImages: [1, 2, 3, 4].map((n) => stored(`published/collage/p${n}`)),
        publishedAt: at(NOW - 5000),
      }),
      list("thin", { coverImageUrl: "null", previewImages: [], publishedAt: at(NOW - 10) }),
      list("old", { publishedAt: at(NOW - (FRESH_DAYS + 1) * DAY) }),
      list("banned", { authorUid: "u3", publishedAt: at(NOW - 10) }),
      list("free", { authorUid: "u4", publishedAt: at(NOW - 20) }),
    ];
    const db = fakeDb({
      publishedLists: lists,
      bans: [
        ["u3", { until: null }],
        ["u4", { until: NOW - 1 }],
      ],
    });
    const answer = await readHomeFirst(db, NOW);
    assert.deepEqual(
      answer.fresh.map((one) => one.id),
      ["free", "ann1", "bob1", "ann2", "ann3"],
    );
  });

  it("tells a guest each list as the proxy does, pictures at the site's address", () => {
    const [, data] = list("L1", {
      anonymous: true,
      title: "Cats",
      translations: { ru: { Cats: "Кошки" }, xx: { Cats: "?" } },
      coverImageUrl: "null",
      previewImages: [stored("published/L1/a"), stored("published/L1/b"), "null"],
      items: [
        { imageUrl: stored("published/L1/a"), pictureFocus: { x: 0.2, y: 0.3 }, tierIndex: 0 },
        { imageUrl: stored("published/L1/b"), tierIndex: 7 },
      ],
      basedOn: { id: "L0", title: "Dogs", authorUid: "u9" },
    });
    const summary = publicMediaJson(guestSummary("L1", data)) as ReturnType<typeof guestSummary>;
    assert.deepEqual(summary, {
      id: "L1",
      title: "Cats",
      names: { ru: "Кошки" },
      authorUid: "",
      authorName: "",
      authorPhotoUrl: null,
      anonymous: true,
      tierCounts: [1, 0, 1],
      category: "film_tv",
      itemCount: 10,
      coverImageUrl: null,
      previewImages: [site("published/L1/a"), site("published/L1/b")],
      previewFocus: [{ x: 0.2, y: 0.3 }, null],
      collageUrl: `https://tieryourlife.com/img/collage/L1.webp?v=${NOW - DAY}`,
      tierColors: ["#f00"],
      topicId: null,
      topicName: null,
      updatedAt: NOW - DAY,
      takeCount: 0,
      rankingCount: 0,
      basedOn: { id: "L0", title: "Dogs", authorUid: "u9", authorName: "" },
    });
    // A named list carries its author; its cover goes out, and no collage.
    const [, named] = list("L2", { authorPhotoUrl: stored("avatars/u1/face") });
    const shown = publicMediaJson(guestSummary("L2", named)) as Record<string, unknown>;
    assert.equal(shown.authorUid, "u1");
    assert.equal(shown.authorPhotoUrl, site("avatars/u1/face"));
    assert.equal(shown.coverImageUrl, site("published/L2/cover"));
    assert.equal("collageUrl" in shown, false);
    assert.equal("mine" in shown || "viewerFollowsAuthor" in shown, false);
  });

  it("gives the tiles of approved sections that are not hidden, ordered by the last month's lists", async () => {
    const db = fakeDb({
      sections: [
        [
          "film_tv",
          {
            status: "approved",
            name: "Film & TV",
            names: { ru: "Кино" },
            icon: "movie",
            builtIn: true,
            rank: 1,
            picture: { url: stored("sections/film_tv/abc") },
            pictureFocus: { x: 0.5, y: 0.1 },
            approvedAt: at(5),
          },
        ],
        ["games", { status: "approved", name: "Games", rank: null, picture: null }],
        ["secret", { status: "approved", name: "Secret", hidden: true }],
        ["asked", { status: "pending", name: "Asked" }],
      ],
      publishedLists: [
        list("f1", { category: "games" }),
        list("f2", { category: "games", underReview: true }),
        list("f3", { category: "games", updatedAt: at(NOW - 40 * DAY) }),
        list("f4", { category: "games" }),
      ],
    });
    const answer = await readHomeFirst(db, NOW);
    assert.deepEqual(answer.sections, [
      {
        id: "film_tv",
        name: "Film & TV",
        names: { ru: "Кино" },
        icon: "movie",
        pictureUrl: site("sections/film_tv/abc"),
        pictureFocus: { x: 0.5, y: 0.1 },
        status: "approved",
        builtIn: true,
        hidden: false,
        rank: 1,
        approvedAt: 5,
        lists30d: 0,
        following: false,
      },
      {
        id: "games",
        name: "Games",
        names: {},
        pictureUrl: null,
        status: "approved",
        builtIn: false,
        hidden: false,
        rank: null,
        approvedAt: null,
        lists30d: 2,
        following: false,
      },
    ]);
  });

  it("takes turns as the proxy's freshRow does, at most three each and twelve in all", () => {
    const rows = ["a", "a", "a", "a", "b", "c", "b"].map((authorUid, n) => ({ authorUid, n }));
    assert.deepEqual(
      freshRow(rows).map((one) => one.n),
      [0, 4, 5, 1, 6, 2],
    );
    const many = Array.from({ length: 20 }, (_, n) => ({ authorUid: `u${n}` }));
    assert.equal(freshRow(many).length, 12);
  });

  it("answers everybody with one read for half a minute, and reads again after a failure", async () => {
    forgetHomeFirstForTests();
    const db = fakeDb({});
    let reads = 0;
    const read = async () => {
      reads += 1;
      return { sections: [], fresh: [], popular: { lists: [], nextCursor: null }, at: reads };
    };
    const first = await homeFirst(db, NOW, read);
    assert.equal((await homeFirst(db, NOW + HOME_FIRST_MS - 1, read)).at, first.at);
    assert.equal(reads, 1);
    await homeFirst(db, NOW + HOME_FIRST_MS, read);
    assert.equal(reads, 2);
    forgetHomeFirstForTests();
    await assert.rejects(homeFirst(db, NOW, () => Promise.reject(new Error("down"))));
    await homeFirst(db, NOW + 1, read);
    assert.equal(reads, 3);
    forgetHomeFirstForTests();
  });
});

describe("GET /api/home", () => {
  const answerOf = async (deps: WebDeps, method: string, query: Record<string, string> = {}) => {
    const answer = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
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
    };
    const request = { method, path: "/api/home", query, header: () => undefined };
    await route(request as unknown as Request, response as unknown as Response, deps);
    return answer;
  };
  const refuse = async () => {
    throw new Error("no token or account is asked for here");
  };
  const empty: HomeFirst = {
    sections: [],
    fresh: [],
    popular: { lists: [], nextCursor: null },
    at: NOW,
  };
  const deps = (read: WebDeps["homeFirst"]): WebDeps => ({
    db: () => fakeDb({}),
    appCheck: refuse,
    freshAppCheck: refuse,
    user: refuse,
    account: refuse,
    viewer: refuse,
    random: () => 0,
    forgetPictures: async () => undefined,
    now: () => NOW,
    homeFirst: read,
  });

  it("answers without App Check or an account, kept at the edge a minute", async () => {
    forgetHomeFirstForTests();
    const answer = await answerOf(
      deps(async () => empty),
      "GET",
    );
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, empty);
    assert.equal(answer.headers["Cache-Control"], HOME_FIRST_CACHE);
    // With the half minute kept in memory, a takedown reaches nobody new within a minute.
    assert.equal(HOME_FIRST_CACHE, "public, max-age=0, s-maxage=30");
    assert.ok(HOME_FIRST_MS + 30_000 <= 60_000);
    assert.equal(
      (
        await answerOf(
          deps(async () => empty),
          "POST",
        )
      ).status,
      405,
    );
    forgetHomeFirstForTests();
  });

  it("refuses an address with parameters, which would pass the edge's one copy, without reading", async () => {
    forgetHomeFirstForTests();
    let reads = 0;
    const counted = deps(async () => {
      reads += 1;
      return empty;
    });
    const answer = await answerOf(counted, "GET", { x: "1" });
    assert.equal(answer.status, 400);
    assert.equal(answer.headers["Cache-Control"], "no-store");
    assert.equal(reads, 0);
    forgetHomeFirstForTests();
  });

  it("keeps no failure at the edge", async () => {
    forgetHomeFirstForTests();
    const answer = await answerOf(
      deps(() => Promise.reject(new Error("Firestore is away"))),
      "GET",
    );
    assert.equal(answer.status, 503);
    assert.equal(answer.headers["Cache-Control"], "no-store");
    forgetHomeFirstForTests();
  });
});
