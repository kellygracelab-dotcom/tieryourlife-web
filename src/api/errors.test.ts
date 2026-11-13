import { describe, expect, it, vi } from "vitest";
import { ApiFailure, parseApiError } from "./errors";

const json = (body: unknown) => JSON.stringify(body);

describe("parseApiError", () => {
  it("accepts an HTTP retry date and discards unusable quota dates", () => {
    const refusal = json({ code: "TOO_MANY_LISTS", retryAt: 1e25 });
    const date = "Fri, 13 Nov 2026 09:10:11 GMT";
    expect(parseApiError(409, refusal, date)).toEqual({
      kind: "tooManyLists",
      retryAt: Date.parse(date),
    });
    for (const malformed of ["-4", "later", "999999999999999999999999"]) {
      expect(parseApiError(409, refusal, malformed)).toEqual({ kind: "tooManyLists" });
    }
  });

  it.each([
    [
      400,
      json({ error: "A list needs a title", code: "INVALID" }),
      { kind: "invalid", detail: "A list needs a title", code: "INVALID" },
    ],
    [400, "", { kind: "invalid", detail: null, code: null }],
    [
      400,
      json({ error: "Taken", code: "NAME_TAKEN", detail: "food", id: "food" }),
      { kind: "invalid", detail: "Taken", code: "NAME_TAKEN", id: "food", field: "food" },
    ],
    [
      400,
      json({
        error: "Not a section's",
        code: "BAD_PICTURE",
        detail: "too_small",
        why: "too_small",
      }),
      {
        kind: "invalid",
        detail: "Not a section's",
        code: "BAD_PICTURE",
        why: "too_small",
        field: "too_small",
      },
    ],
    [
      400,
      json({ error: "No such section", code: "INVALID", detail: "category" }),
      { kind: "invalid", detail: "No such section", code: "INVALID", field: "category" },
    ],
    [
      400,
      json({ error: "Three waiting", code: "TOO_MANY_PENDING", id: 7 }),
      { kind: "invalid", detail: "Three waiting", code: "TOO_MANY_PENDING" },
    ],
    [
      401,
      json({ error: "Missing App Check token", code: "APP_UNVERIFIED" }),
      { kind: "appUnverified" },
    ],
    [
      401,
      json({ error: "Invalid ID token", code: "UNAUTHENTICATED" }),
      { kind: "unauthenticated" },
    ],
    [401, json({ error: "Sign in first", code: "NOT_SIGNED_IN" }), { kind: "notSignedIn" }],
    // An account erased on another device (QA S8): the forced refresh that
    // follows finds no such user, and Firebase signs this browser out.
    [
      401,
      json({ error: "This account was deleted", code: "ACCOUNT_ERASED" }),
      { kind: "unauthenticated" },
    ],
    [401, "not json at all", { kind: "unauthenticated" }],
    [401, "null", { kind: "unauthenticated" }],
    [
      403,
      json({ error: "You cannot publish", code: "BANNED", until: 1789000000000 }),
      { kind: "banned", until: 1789000000000 },
    ],
    [
      403,
      json({ error: "You cannot publish", code: "BANNED", until: null }),
      { kind: "banned", until: null },
    ],
    [403, json({ error: "Not yours", code: "NOT_YOURS" }), { kind: "notYours" }],
    [403, json({ error: "Sign in to publish", code: "NOT_SIGNED_IN" }), { kind: "notSignedIn" }],
    [403, json({ error: "Staff", code: "TARGET_IS_MODERATOR" }), { kind: "targetIsModerator" }],
    [403, "", { kind: "notSignedIn" }],
    [404, json({ error: "No such list", code: "NOT_FOUND" }), { kind: "notFound" }],
    [409, json({ error: "Too many", code: "TOO_MANY_LISTS" }), { kind: "tooManyLists" }],
    [409, json({ error: "Too many", code: "TOO_MANY_FOLLOWING" }), { kind: "tooManyFollowing" }],
    [409, json({ error: "Too many", code: "TOO_MANY_BOARDS" }), { kind: "tooManyBoards" }],
    [409, json({ code: "TOO_MANY_PENDING_TOPICS" }), { kind: "tooManyTopics" }],
    [409, json({ error: "That page is gone", code: "CURSOR_GONE" }), { kind: "cursorGone" }],
    [409, json({ error: "Moved on", code: "CONFLICT" }), { kind: "conflict" }],
    [409, json({ error: "Decided", code: "SETTLED" }), { kind: "conflict" }],
    [
      409,
      json({ error: "Decided", code: "SETTLED", status: "approved" }),
      { kind: "conflict", status: "approved" },
    ],
    [
      409,
      json({ error: "Taken", code: "NAME_TAKEN", detail: "t1", id: "t1" }),
      { kind: "invalid", detail: "Taken", code: "NAME_TAKEN", id: "t1" },
    ],
    [
      409,
      json({ error: "Taken", code: "NAME_TAKEN", detail: "t1", id: "t1", section: "food" }),
      { kind: "invalid", detail: "Taken", code: "NAME_TAKEN", id: "t1", section: "food" },
    ],
    [409, json({ code: "NAME_TAKEN" }), { kind: "invalid", detail: null, code: "NAME_TAKEN" }],
    [
      410,
      json({ error: "Merged", code: "MERGED", detail: "food", mergedInto: "food" }),
      { kind: "merged", into: "food", topic: null },
    ],
    [
      410,
      json({ error: "Merged", code: "MERGED", mergedInto: "games", mergedTopicId: "t7" }),
      { kind: "merged", into: "games", topic: "t7" },
    ],
    [410, json({ error: "Merged", code: "MERGED" }), { kind: "merged", into: null, topic: null }],
    [410, json({ error: "Gone" }), { kind: "unknown", status: 410 }],
    [
      413,
      json({ error: "Too many items", code: "TOO_LARGE" }),
      { kind: "tooLarge", detail: "Too many items" },
    ],
    [
      422,
      json({ error: "Refused", code: "PICTURE_REFUSED", because: "adult" }),
      { kind: "pictureRefused", because: "adult", code: "PICTURE_REFUSED" },
    ],
    [422, json({ error: "Refused" }), { kind: "pictureRefused", because: null }],
    [
      422,
      json({ code: "KEEP_LIMIT" }),
      { kind: "pictureRefused", because: "KEEP_LIMIT", code: "KEEP_LIMIT" },
    ],
    [
      422,
      json({ code: "PICTURE_REFUSED", because: "adult", imageUrl: "https://x.test/p.jpg" }),
      {
        kind: "pictureRefused",
        because: "adult",
        imageUrl: "https://x.test/p.jpg",
        code: "PICTURE_REFUSED",
      },
    ],
    // A house editor's credit refused: why, and the card or the cover it is on.
    [
      400,
      json({ code: "BAD_ATTRIBUTION", reason: "NO_LICENSE", itemIndex: 2, error: "No licence" }),
      {
        kind: "invalid",
        code: "BAD_ATTRIBUTION",
        detail: "No licence",
        why: "NO_LICENSE",
        itemIndex: 2,
      },
    ],
    [
      400,
      json({ code: "BAD_ATTRIBUTION", reason: "BAD_LINK", cover: true }),
      { kind: "invalid", code: "BAD_ATTRIBUTION", detail: null, why: "BAD_LINK", cover: true },
    ],
    [
      400,
      json({ code: "BAD_ATTRIBUTION", itemIndex: -1 }),
      { kind: "invalid", code: "BAD_ATTRIBUTION", detail: null },
    ],
    // A house publication of a picture from a link without its page names the card.
    [
      422,
      json({ code: "PICTURE_LINK_NEEDED", itemIndex: 3 }),
      {
        kind: "pictureRefused",
        because: "PICTURE_LINK_NEEDED",
        code: "PICTURE_LINK_NEEDED",
        itemIndex: 3,
      },
    ],
    [
      422,
      json({ code: "PICTURE_LINK_NEEDED", itemIndex: -1 }),
      { kind: "pictureRefused", because: "PICTURE_LINK_NEEDED", code: "PICTURE_LINK_NEEDED" },
    ],
    // A picture from a link: the refusal carries what is left of the day.
    [
      422,
      json({ code: "NOT_A_PICTURE", quota: { left: 12, limit: 400, resetsAt: 1_800_000_000_000 } }),
      {
        kind: "pictureRefused",
        because: "NOT_A_PICTURE",
        code: "NOT_A_PICTURE",
        quota: { left: 12, limit: 400, resetsAt: 1_800_000_000_000 },
      },
    ],
    [
      429,
      json({
        code: "LINK_LIMIT",
        retryAt: 1_800_000_000_000,
        quota: { left: 0, limit: 400, resetsAt: 1_800_003_600_000 },
      }),
      {
        kind: "linkLimit",
        retryAt: 1_800_000_000_000,
        quota: { left: 0, limit: 400, resetsAt: 1_800_003_600_000 },
      },
    ],
    [429, json({ code: "LINK_LIMIT", quota: { left: "x" } }), { kind: "linkLimit" }],
    [
      429,
      json({ error: "Ten today", code: "TOO_MANY_PROPOSALS" }),
      { kind: "tooManyRequests", code: "TOO_MANY_PROPOSALS" },
    ],
    [429, "", { kind: "tooManyRequests", code: null }],
    [
      429,
      json({ error: "Too many picture searches", code: "SEARCH_LIMIT", retryAt: 1794571200000 }),
      { kind: "searchLimit", retryAt: 1794571200000 },
    ],
    [429, json({ code: "SEARCH_LIMIT" }), { kind: "searchLimit" }],
    [503, json({ error: "Unavailable", code: "UNAVAILABLE" }), { kind: "unavailable" }],
    [503, "", { kind: "unavailable" }],
    // The picture's site is busy: a wait, with the day's links given back.
    [
      503,
      json({
        code: "SOURCE_BUSY",
        retryAt: 1_800_000_060_000,
        quota: { left: 12, limit: 400, resetsAt: 1_800_003_600_000 },
      }),
      {
        kind: "sourceBusy",
        retryAt: 1_800_000_060_000,
        quota: { left: 12, limit: 400, resetsAt: 1_800_003_600_000 },
      },
    ],
    [503, json({ code: "SOURCE_BUSY" }), { kind: "sourceBusy" }],
    [405, json({ error: "Use GET" }), { kind: "unknown", status: 405 }],
    [500, "[]", { kind: "unknown", status: 500 }],
  ])("maps %i %s", (status, body, expected) => {
    expect(parseApiError(status, body)).toEqual(expected);
  });
});

it("takes the time picture searches start again from Retry-After without one in the body", () => {
  vi.useFakeTimers({ now: 1_000_000 });
  try {
    expect(parseApiError(429, json({ code: "SEARCH_LIMIT" }), "120")).toEqual({
      kind: "searchLimit",
      retryAt: 1_120_000,
    });
    // Pictures from links the same way.
    expect(parseApiError(429, json({ code: "LINK_LIMIT" }), "60")).toEqual({
      kind: "linkLimit",
      retryAt: 1_060_000,
    });
    // And a busy picture site.
    expect(parseApiError(503, json({ code: "SOURCE_BUSY" }), "30")).toEqual({
      kind: "sourceBusy",
      retryAt: 1_030_000,
    });
  } finally {
    vi.useRealTimers();
  }
});

describe("ApiFailure", () => {
  it("carries the parsed error and names itself", () => {
    const failure = new ApiFailure({ kind: "offline" });
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe("ApiFailure");
    expect(failure.error).toEqual({ kind: "offline" });
    expect(failure.message).toContain("offline");
  });
});
