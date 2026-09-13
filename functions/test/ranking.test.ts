import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimHashOf,
  claimMatches,
  CODE_ALPHABET,
  CODE_LENGTH,
  dayKey,
  decideClaim,
  decideClaimToken,
  decideListId,
  decideRows,
  firstImageOf,
  fromStoredRows,
  isCode,
  makeCode,
  MAX_CLAIM_TOKEN_LENGTH,
  MIN_WRITE_GAP_MS,
  newestFirst,
  placedCount,
  snapshotOf,
  summaryOf,
  tooSoon,
  toStoredRows,
  type RankingSummary,
  type StoredOwner,
} from "../src/ranking";

describe("stored rows", () => {
  it("wrap each row in a map, because Firestore refuses nested arrays, and unwrap it", () => {
    const stored = toStoredRows([[2, 0], [], [1]]);
    assert.deepEqual(stored, [{ items: [2, 0] }, { items: [] }, { items: [1] }]);
    assert.deepEqual(fromStoredRows(stored), [[2, 0], [], [1]]);
  });

  it("read anything odd as empty rows rather than throwing", () => {
    assert.deepEqual(fromStoredRows(null), []);
    assert.deepEqual(fromStoredRows([null, {}, { items: "x" }, { items: [1, "a", 2.5] }]), [
      [],
      [],
      [],
      [1],
    ]);
  });
});

describe("decideRows", () => {
  it("accepts rows that place each card at most once", () => {
    const decision = decideRows({ listId: "wMRMFDxo8UejcAi2VVMW", rows: [[2, 0], [], [1]] }, 3, 3);
    assert.deepEqual(decision, {
      ok: true,
      listId: "wMRMFDxo8UejcAi2VVMW",
      rows: [[2, 0], [], [1]],
    });
  });

  const refusals: [string, unknown][] = [
    ["no list id", { rows: [[0]] }],
    ["a list id that could be a path", { listId: "../x", rows: [[0]] }],
    ["rows for another number of tiers", { listId: "abcdefgh", rows: [[0]] }],
    ["rows that are not arrays", { listId: "abcdefgh", rows: [0, 1] }],
    ["a card outside the list", { listId: "abcdefgh", rows: [[5], []] }],
    ["a negative card", { listId: "abcdefgh", rows: [[-1], []] }],
    ["a fractional card", { listId: "abcdefgh", rows: [[0.5], []] }],
    ["a card placed twice", { listId: "abcdefgh", rows: [[0], [0]] }],
    ["nothing placed", { listId: "abcdefgh", rows: [[], []] }],
    ["no body", null],
  ];
  for (const [name, body] of refusals) {
    it(`refuses ${name} with 400 INVALID`, () => {
      const decision = decideRows(body, 2, 3);
      assert.equal(decision.ok, false);
      if (!decision.ok) {
        assert.equal(decision.status, 400);
        assert.equal(decision.code, "INVALID");
      }
    });
  }
});

describe("decideListId", () => {
  it("takes a Firestore id and nothing that could climb out of one", () => {
    assert.equal(decideListId({ listId: "wMRMFDxo8UejcAi2VVMW" }), "wMRMFDxo8UejcAi2VVMW");
    assert.equal(decideListId({ listId: "a/b" }), null);
    assert.equal(decideListId({ listId: "short" }), null);
    assert.equal(decideListId({}), null);
    assert.equal(decideListId(undefined), null);
  });
});

describe("codes", () => {
  it("are eight characters from an alphabet without look-alikes", () => {
    assert.equal(CODE_LENGTH, 8);
    for (const ch of "0O1lI") assert.equal(CODE_ALPHABET.includes(ch), false);
    const code = makeCode(() => 0);
    assert.equal(code, CODE_ALPHABET[0]!.repeat(8));
    assert.equal(isCode(code), true);
  });

  it("use every value the random source gives", () => {
    let i = 0;
    const code = makeCode((max) => i++ % max);
    assert.equal(code, CODE_ALPHABET.slice(0, 8));
  });

  it("are told apart from anything else", () => {
    assert.equal(isCode("abcdefgh"), true);
    assert.equal(isCode("abcdefg"), false);
    assert.equal(isCode("abcdefg0"), false);
    assert.equal(isCode("ABCDEFGH"), false);
    assert.equal(isCode(42), false);
  });
});

describe("tooSoon", () => {
  it("lets the first write through and holds the next one for a moment", () => {
    assert.equal(tooSoon(null, 10_000), false);
    assert.equal(tooSoon(10_000, 10_000 + MIN_WRITE_GAP_MS - 1), true);
    assert.equal(tooSoon(10_000, 10_000 + MIN_WRITE_GAP_MS), false);
  });
});

describe("dayKey", () => {
  it("is the UTC day", () => {
    assert.equal(dayKey(Date.UTC(2026, 8, 12, 23, 59)), "2026-09-12");
    assert.equal(dayKey(Date.UTC(2026, 8, 13, 0, 0)), "2026-09-13");
  });
});

describe("snapshotOf", () => {
  it("keeps what the board needs and only https pictures", () => {
    const snapshot = snapshotOf({
      title: "Films",
      authorName: "danylo",
      authorPhotoUrl: "http://insecure/face",
      category: "film_tv",
      tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
      items: [
        { title: "Ex Machina", imageUrl: "https://img/ex.jpg", tierIndex: 0 },
        { title: "Old", imageUrl: null },
      ],
      authorUid: "secret",
    });
    assert.deepEqual(snapshot, {
      title: "Films",
      authorName: "danylo",
      authorPhotoUrl: null,
      category: "film_tv",
      tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
      items: [
        { title: "Ex Machina", imageUrl: "https://img/ex.jpg", tierIndex: 0 },
        { title: "Old", imageUrl: null, tierIndex: null },
      ],
    });
    assert.equal("authorUid" in snapshot, false);
  });

  it("survives a document with fields missing", () => {
    const snapshot = snapshotOf({ title: 5, authorName: undefined });
    assert.deepEqual(snapshot, {
      title: "",
      authorName: "",
      authorPhotoUrl: null,
      category: "other",
      tiers: [],
      items: [],
    });
  });
});

describe("claim tokens", () => {
  it("are kept as their sha256 hex and matched against it", () => {
    assert.equal(
      claimHashOf("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(claimMatches(claimHashOf("abc"), "abc"), true);
    assert.equal(claimMatches(claimHashOf("abc"), "abd"), false);
  });

  it("never match a hash of another length, and do not throw on one", () => {
    assert.equal(claimMatches("", "abc"), false);
    assert.equal(claimMatches(claimHashOf("abc").slice(1), "abc"), false);
  });
});

describe("decideClaimToken", () => {
  it("takes a non-empty string up to the longest token handed out", () => {
    const longest = "x".repeat(MAX_CLAIM_TOKEN_LENGTH);
    assert.equal(decideClaimToken({ claimToken: "t" }), "t");
    assert.equal(decideClaimToken({ claimToken: longest }), longest);
  });

  const refusals: [string, unknown][] = [
    ["no body", null],
    ["no token", {}],
    ["an empty token", { claimToken: "" }],
    ["a token that is not text", { claimToken: 42 }],
    ["a token longer than any handed out", { claimToken: "x".repeat(MAX_CLAIM_TOKEN_LENGTH + 1) }],
  ];
  for (const [name, body] of refusals) {
    it(`refuses ${name}`, () => {
      assert.equal(decideClaimToken(body), null);
    });
  }
});

describe("decideClaim", () => {
  const token = "the-token";
  const owned = (ownerUid: string | null, ownerAnonymous: boolean): StoredOwner => ({
    ownerUid,
    ownerAnonymous,
    claimHash: claimHashOf(token),
  });

  it("hands a guest's ranking to the account showing the token", () => {
    assert.deepEqual(decideClaim(owned("guest", true), "person", token), { ok: true, write: true });
  });

  it("hands a ranking nobody owns to the account showing the token", () => {
    assert.deepEqual(decideClaim(owned(null, false), "person", token), { ok: true, write: true });
  });

  it("keeps a ranking the same account already kept, with nothing to write", () => {
    assert.deepEqual(decideClaim(owned("person", false), "person", token), {
      ok: true,
      write: false,
    });
  });

  it("stops calling the owner a guest once that uid has signed in", () => {
    assert.deepEqual(decideClaim(owned("person", true), "person", token), {
      ok: true,
      write: true,
    });
  });

  const refusals: [string, StoredOwner, string, number, string][] = [
    ["a wrong token for a guest's ranking", owned("guest", true), "other", 403, "NOT_YOURS"],
    ["a wrong token for a ranking nobody owns", owned(null, false), "other", 403, "NOT_YOURS"],
    ["a wrong token even from the owner", owned("person", false), "other", 403, "NOT_YOURS"],
    ["a ranking another account keeps", owned("someone", false), token, 409, "CLAIMED"],
  ];
  for (const [name, owner, offered, status, code] of refusals) {
    it(`refuses ${name} with ${status} ${code}`, () => {
      const decision = decideClaim(owner, "person", offered);
      assert.equal(decision.ok, false);
      if (!decision.ok) {
        assert.equal(decision.status, status);
        assert.equal(decision.code, code);
      }
    });
  }
});

describe("placedCount", () => {
  it("counts the cards across every row", () => {
    assert.equal(placedCount([[2, 0], [], [1]]), 3);
    assert.equal(placedCount([]), 0);
  });
});

describe("firstImageOf", () => {
  it("skips cards without a picture and anything that is not https", () => {
    const items = [
      { title: "a", imageUrl: null, tierIndex: null },
      { title: "b", imageUrl: "http://x/b", tierIndex: null },
      { title: "c", imageUrl: "https://x/c", tierIndex: null },
    ];
    assert.equal(firstImageOf(items), "https://x/c");
    assert.equal(firstImageOf([]), null);
  });
});

describe("summaryOf", () => {
  const snapshot = snapshotOf({
    title: "Films",
    authorName: "danylo",
    authorPhotoUrl: "https://img/face",
    category: "film_tv",
    tiers: [{ label: "S" }, { label: "A" }],
    items: [
      { title: "Old", imageUrl: null },
      { title: "Ex Machina", imageUrl: "https://img/ex.jpg" },
      { title: "Her", imageUrl: "https://img/her.jpg" },
    ],
  });

  it("is the card of a ranking: what it ranked, how far, and its first picture", () => {
    const summary = summaryOf("abcdefgh", {
      listId: "wMRMFDxo8UejcAi2VVMW",
      snapshot,
      rows: toStoredRows([[2], [1]]),
      createdAt: { toMillis: () => 1_700_000_000_000 },
    });
    assert.deepEqual(summary, {
      code: "abcdefgh",
      listId: "wMRMFDxo8UejcAi2VVMW",
      title: "Films",
      authorName: "danylo",
      authorPhotoUrl: "https://img/face",
      category: "film_tv",
      placed: 2,
      itemCount: 3,
      imageUrl: "https://img/ex.jpg",
      createdAt: 1_700_000_000_000,
    });
  });

  it("has no picture when no card has one, and no time before the server stamped it", () => {
    const summary = summaryOf("abcdefgh", {
      listId: "wMRMFDxo8UejcAi2VVMW",
      snapshot: { ...snapshot, items: [{ title: "Old", imageUrl: null, tierIndex: null }] },
      rows: null,
    });
    assert.equal(summary.imageUrl, null);
    assert.equal(summary.placed, 0);
    assert.equal(summary.itemCount, 1);
    assert.equal(summary.createdAt, 0);
  });
});

describe("newestFirst", () => {
  const card = (code: string, createdAt: number): RankingSummary => ({
    code,
    listId: "wMRMFDxo8UejcAi2VVMW",
    title: "",
    authorName: "",
    authorPhotoUrl: null,
    category: "other",
    placed: 0,
    itemCount: 0,
    imageUrl: null,
    createdAt,
  });

  it("puts the latest ranking first and leaves the given order alone", () => {
    const given = [card("aaaaaaaa", 1), card("cccccccc", 3), card("bbbbbbbb", 2)];
    const codes = (list: RankingSummary[]) => list.map((item) => item.code);
    assert.deepEqual(codes(newestFirst(given)), ["cccccccc", "bbbbbbbb", "aaaaaaaa"]);
    assert.deepEqual(codes(given), ["aaaaaaaa", "cccccccc", "bbbbbbbb"]);
  });
});
