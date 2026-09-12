import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  dayKey,
  decideListId,
  decideRows,
  fromStoredRows,
  isCode,
  makeCode,
  MIN_WRITE_GAP_MS,
  snapshotOf,
  tooSoon,
  toStoredRows,
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
