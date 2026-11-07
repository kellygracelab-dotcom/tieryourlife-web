import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { bannedAnswer, isBanned, longerBan, readBan } from "../src/bans";
import { hashedKey, identityKeys, signInsOfToken } from "../src/banIdentities";

/** One `bans` document, or none, and any `bannedIdentities` records, as Firestore hands them back. */
const holding = (
  data: Record<string, unknown> | undefined,
  kept: Record<string, Record<string, unknown>> = {},
) =>
  ({
    collection: (name: string) => ({
      doc: (id: string) => {
        const found =
          name === "bans" && id === "person"
            ? data
            : name === "bannedIdentities"
              ? kept[id]
              : undefined;
        return {
          get: async () => ({
            exists: found !== undefined,
            get: (field: string) => found?.[field],
          }),
        };
      },
    }),
  }) as unknown as Firestore;

const person = (banKeys: string[] = []) => ({ uid: "person", banKeys });

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
    assert.equal(await readBan(holding(undefined), person()), null);
    assert.deepEqual(await readBan(holding({ until: 7, bannedAt: 1, reason: "spam" }), person()), {
      until: 7,
    });
    assert.deepEqual(await readBan(holding({ until: null, bannedAt: 1 }), person()), {
      until: null,
    });
    // The proxy's `until > now` is false for anything but a number: nobody is banned by it.
    assert.equal(await readBan(holding({ bannedAt: 1 }), person()), null);
    assert.equal(await readBan(holding({ until: "soon" }), person()), null);
  });

  // QA S12: a ban kept by the proxy from an erased account is read beside the account's own.
  it("finds a ban kept under a hashed sign-in, and the one that lifts last wins", async () => {
    const key = hashedKey("google.com:sub-1");
    assert.deepEqual(
      await readBan(holding(undefined, { [key]: { until: 9, bannedAt: 1 } }), person([key])),
      {
        until: 9,
      },
    );
    // A record the proxy would not read (no bannedAt) bans nobody.
    assert.equal(await readBan(holding(undefined, { [key]: { until: 9 } }), person([key])), null);
    // A key the person does not hold is not asked about.
    assert.equal(
      await readBan(holding(undefined, { [key]: { until: 9, bannedAt: 1 } }), person()),
      null,
    );
    assert.deepEqual(
      await readBan(holding({ until: 5 }, { [key]: { until: 9, bannedAt: 1 } }), person([key])),
      { until: 9 },
    );
    assert.deepEqual(
      await readBan(holding({ until: 50 }, { [key]: { until: null, bannedAt: 1 } }), person([key])),
      { until: null },
    );
    assert.deepEqual(longerBan({ until: null }, { until: 3 }), { until: null });
    assert.deepEqual(longerBan({ until: 3 }, { until: 4 }), { until: 4 });
  });

  it("makes the keys the proxy makes: a verified address and each provider's id, hashed", () => {
    // SHA-256 of "abc", the standard test vector.
    assert.equal(
      hashedKey("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const signIns = signInsOfToken({
      "google.com": ["sub-1"],
      password: ["someone@example.com"],
      email: ["someone@example.com"],
      anonymous: ["x"],
      custom: ["y"],
      "apple.com": ["", 7, "apple-2"],
    });
    assert.deepEqual(identityKeys("  Someone@Example.COM ", signIns), [
      hashedKey("email:someone@example.com"),
      hashedKey("google.com:sub-1"),
      hashedKey("apple.com:apple-2"),
    ]);
    assert.deepEqual(identityKeys(null, []), []);
    assert.deepEqual(signInsOfToken(undefined), []);
    assert.deepEqual(signInsOfToken({ "google.com": "not a list" }), []);
  });
});
