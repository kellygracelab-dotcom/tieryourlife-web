import { describe, expect, it } from "vitest";
import { ApiFailure, parseApiError } from "./errors";

const json = (body: unknown) => JSON.stringify(body);

describe("parseApiError", () => {
  it.each([
    [
      400,
      json({ error: "A list needs a title", code: "INVALID" }),
      { kind: "invalid", detail: "A list needs a title" },
    ],
    [400, "", { kind: "invalid", detail: null }],
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
    [403, "", { kind: "notSignedIn" }],
    [404, json({ error: "No such list", code: "NOT_FOUND" }), { kind: "notFound" }],
    [409, json({ error: "Too many", code: "TOO_MANY_LISTS" }), { kind: "tooManyLists" }],
    [409, json({ error: "That page is gone", code: "CURSOR_GONE" }), { kind: "cursorGone" }],
    [409, json({ error: "Moved on", code: "CONFLICT" }), { kind: "conflict" }],
    [
      413,
      json({ error: "Too many items", code: "TOO_LARGE" }),
      { kind: "tooLarge", detail: "Too many items" },
    ],
    [
      422,
      json({ error: "Refused", code: "PICTURE_REFUSED", because: "adult" }),
      { kind: "pictureRefused", because: "adult" },
    ],
    [422, json({ error: "Refused" }), { kind: "pictureRefused", because: null }],
    [503, json({ error: "Unavailable", code: "UNAVAILABLE" }), { kind: "unavailable" }],
    [405, json({ error: "Use GET" }), { kind: "unknown", status: 405 }],
    [500, "[]", { kind: "unknown", status: 500 }],
  ])("maps %i %s", (status, body, expected) => {
    expect(parseApiError(status, body)).toEqual(expected);
  });
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
