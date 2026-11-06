import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { bannedAnswer, isBanned, readBan } from "../src/bans";

/** One `bans` document, or none, as Firestore hands it back. */
const holding = (data: Record<string, unknown> | undefined) =>
  ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: name === "bans" && id === "person" && data !== undefined,
          get: (field: string) => data?.[field],
        }),
      }),
    }),
  }) as unknown as Firestore;

describe("bans", () => {
  it("reads a ban as the proxy does: there, and not over yet", () => {
    assert.equal(isBanned(null, 1_000), false);
    assert.equal(isBanned({ until: null }, 1_000), true);
    assert.equal(isBanned({ until: 1_001 }, 1_000), true);
    assert.equal(isBanned({ until: 1_000 }, 1_000), false);
    assert.equal(isBanned({ until: 999 }, 1_000), false);
  });

  it("answers in the proxy's words, with when it ends", () => {
    assert.deepEqual(bannedAnswer({ until: 5 }), {
      error: "You cannot rank at the moment",
      code: "BANNED",
      until: 5,
    });
  });

  it("finds the ban on an account, and none where the document says no end it knows", async () => {
    assert.equal(await readBan(holding(undefined), "person"), null);
    assert.deepEqual(await readBan(holding({ until: 7, bannedAt: 1, reason: "spam" }), "person"), {
      until: 7,
    });
    assert.deepEqual(await readBan(holding({ until: null, bannedAt: 1 }), "person"), {
      until: null,
    });
    // The proxy's `until > now` is false for anything but a number: nobody is banned by it.
    assert.equal(await readBan(holding({ bannedAt: 1 }), "person"), null);
    assert.equal(await readBan(holding({ until: "soon" }), "person"), null);
  });
});
