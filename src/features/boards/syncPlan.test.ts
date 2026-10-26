import { describe, expect, it } from "vitest";
import { planSync, type RemoteBoard, type SyncedBoard, type SyncStep } from "./syncPlan";

// The phone's own cases (`BoardSyncPlanTest`), one for one.
const board = "board-1";
const local = (fingerprint = "aaa") => [{ uid: board, fingerprint }];
const remote = (
  revision = 3,
  deleted = false,
  fingerprint: string | null = null,
): RemoteBoard[] => [{ uid: board, revision, deleted, fingerprint }];
const synced = (revision = 3, fingerprint = "aaa"): SyncedBoard[] => [
  { uid: board, revision, fingerprint },
];

describe("planSync", () => {
  const cases: [string, SyncStep[], Parameters<typeof planSync>][] = [
    [
      "a board the account has never seen is sent",
      [{ kind: "create", uid: board }],
      [local(), [], []],
    ],
    [
      "a board changed only here is sent over what the account has",
      [{ kind: "update", uid: board, basedOn: 3 }],
      [local("bbb"), remote(3), synced(3)],
    ],
    [
      "a board changed only in the account comes back down",
      [{ kind: "restore", uid: board }],
      [local(), remote(4), synced(3)],
    ],
    ["a board nobody touched costs nothing", [], [local(), remote(3), synced(3)]],
    [
      "a board changed in both places is kept twice",
      [{ kind: "keepBoth", uid: board, basedOn: 4 }],
      [local("bbb"), remote(4), synced(3)],
    ],
    [
      "a board on the account and not here is brought down",
      [{ kind: "adopt", uid: board }],
      [[], remote(), []],
    ],
    [
      "a board thrown away here is reported to the account",
      [{ kind: "forget", uid: board }],
      [[], remote(), synced()],
    ],
    [
      "a board thrown away in the account goes here too",
      [{ kind: "discardLocal", uid: board }],
      [local(), remote(3, true), synced()],
    ],
    ["a board already gone from both sides is left alone", [], [[], remote(3, true), synced()]],
    [
      "a marker in the account with no agreement here brings the board back over it",
      [{ kind: "revive", uid: board, basedOn: 3 }],
      [local(), remote(3, true), []],
    ],
    [
      "a store back from a backup does not duplicate anything",
      [{ kind: "remember", uid: board, revision: 2 }],
      [local("aaa"), remote(2, false, "aaa"), []],
    ],
    [
      "a store back from a backup keeps both when it really differs",
      [{ kind: "keepBoth", uid: board, basedOn: 2 }],
      [local("bbb"), remote(2, false, "aaa"), []],
    ],
    [
      "two sides that hold the same board only write down that they agree",
      [{ kind: "remember", uid: board, revision: 9 }],
      [local("aaa"), remote(9, false, "aaa"), synced(3)],
    ],
    [
      "a board the account kept before fingerprints existed is left alone",
      [],
      [local("aaa"), remote(3, false, null), synced(3)],
    ],
  ];

  it.each(cases)("%s", (_name, expected, args) => {
    expect(planSync(...args)).toEqual(expected);
  });

  it("gives every board its own step", () => {
    const steps = planSync(
      [
        { uid: "mine", fingerprint: "aaa" },
        { uid: "edited", fingerprint: "ccc" },
      ],
      [
        { uid: "edited", revision: 1, deleted: false, fingerprint: null },
        { uid: "theirs", revision: 1, deleted: false, fingerprint: null },
      ],
      [{ uid: "edited", revision: 1, fingerprint: "bbb" }],
    );
    expect(steps).toEqual([
      { kind: "create", uid: "mine" },
      { kind: "update", uid: "edited", basedOn: 1 },
      { kind: "adopt", uid: "theirs" },
    ]);
  });
});
