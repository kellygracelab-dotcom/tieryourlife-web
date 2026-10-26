import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KeepBoardRequest, KeptBoard } from "../../api/boards";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import type { SignInOutcome } from "../../lib/signIn";
import { memoryStore } from "../../lib/storage";
import { readBackUp } from "./syncRecords";
import { BoardSyncProvider } from "./BoardSync";
import { useBoardSync } from "./boardSync";
import { newBoard } from "./model";
import { boardsRepository } from "./repository";
import type { BoardsApi } from "./sync";
import { syncRecords } from "./syncRecords";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());
vi.mock("../../lib/firebase", () => ({ getFirebaseStorage: vi.fn() }));

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const signedIn: Account = { kind: "signedIn", uid: "me", displayName: "D", photoUrl: null };

/** A promise settled by hand: what a request looks like while the network thinks. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fakeApi(
  theirs: KeptBoard[] = [],
  options: { pageSize?: number; holdKeeps?: boolean; refuseForget?: boolean } = {},
) {
  const { pageSize = 50, holdKeeps = false, refuseForget = false } = options;
  const kept = new Map(theirs.map((board) => [board.uid, board]));
  const keeps: { uid: string; request: KeepBoardRequest }[] = [];
  const forgotten: string[] = [];
  const indexReads: (string | null)[] = [];
  // Keeps held back until the test lets them go, in the order they were sent.
  const held: (() => void)[] = [];
  const api: BoardsApi = {
    index: (after) => {
      indexReads.push(after);
      const all = [...kept.values()];
      const start = after === null ? 0 : Number(after);
      const page = all.slice(start, start + pageSize);
      return Promise.resolve({
        boards: page.map((board) => ({
          uid: board.uid,
          revision: board.revision,
          updatedAt: board.updatedAt,
          deviceName: board.deviceName,
          deleted: board.deleted,
          fingerprint: board.fingerprint,
          title: board.title,
          itemCount: board.items.length,
        })),
        next: start + pageSize < all.length ? String(start + pageSize) : null,
      });
    },
    board: (uid) => Promise.resolve(kept.get(uid)!),
    keep: (uid, request) => {
      keeps.push({ uid, request });
      const answer = () => {
        const revision = (kept.get(uid)?.revision ?? 0) + 1;
        kept.set(uid, { ...request, uid, revision, updatedAt: 1, deleted: false });
        return { uid, revision };
      };
      if (!holdKeeps) return Promise.resolve(answer());
      const gate = deferred<{ uid: string; revision: number }>();
      held.push(() => gate.resolve(answer()));
      return gate.promise;
    },
    forget: (uid) => {
      if (refuseForget) return Promise.reject(new Error("the account would not"));
      forgotten.push(uid);
      const was = kept.get(uid);
      if (was !== undefined) kept.set(uid, { ...was, deleted: true, revision: was.revision + 1 });
      return Promise.resolve();
    },
    published: () => Promise.resolve([]),
  };
  const releaseKeeps = () => {
    for (const release of held.splice(0)) release();
  };
  return { api, keeps, kept, forgotten, indexReads, releaseKeeps };
}

const theirBoard = (uid: string, title: string): KeptBoard => ({
  ...newBoard(uid, title, 1, uids()),
  revision: 1,
  updatedAt: 1,
  deviceName: "Pixel 7",
  deleted: false,
  fingerprint: "theirs",
});

function Probe() {
  const sync = useBoardSync();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <p data-testid="probe">
        {sync.signedIn ? "in" : "out"} {sync.status} {sync.merge === null ? "-" : "asking"}{" "}
        {sync.backUp ? "on" : "off"}
        {failed && " failed"}
      </p>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          sync.setBackUp(false).catch(() => setFailed(true));
        }}
      >
        stop
      </button>
    </>
  );
}

const sessionOf = (account: Account): Session => ({
  account,
  signIn: () => new Promise<SignInOutcome>(() => undefined),
  signOut: () => Promise.resolve(),
  refresh: () => undefined,
});

const tree = (account: Account, deps: Parameters<typeof BoardSyncProvider>[0]) => (
  <SessionContext.Provider value={sessionOf(account)}>
    <BoardSyncProvider
      {...deps}
      syncAfterMs={10}
      resolvePicture={() => () => Promise.resolve(null)}
    >
      <Probe />
    </BoardSyncProvider>
  </SessionContext.Provider>
);

const show = (account: Account, deps: Parameters<typeof BoardSyncProvider>[0]) =>
  render(tree(account, deps));

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("BoardSyncProvider", () => {
  it("does nothing for a guest", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("a", "A", 1, uids()));
    const { api, keeps } = fakeApi();
    show(GUEST, { children: null, repository, store, api });
    expect(screen.getByTestId("probe")).toHaveTextContent("out idle -");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(keeps).toEqual([]);
  });

  it("sends the boards up on sign-in, and again a moment after a change", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("a", "A", 1, uids()));
    const { api, keeps } = fakeApi();
    show(signedIn, { children: null, repository, store, api, deviceName: "Chrome on Linux" });
    await waitFor(() => expect(keeps).toHaveLength(1));
    expect(keeps[0]).toMatchObject({ uid: "a", request: { deviceName: "Chrome on Linux" } });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("in idle -"));
    expect(syncRecords(store, "me").merged()).toBe(true);

    act(() => repository.save({ ...repository.get("a")!, title: "A2", editedAt: 5 }));
    await waitFor(() => expect(keeps).toHaveLength(2));
    expect(keeps[1]).toMatchObject({ uid: "a", request: { basedOn: 1, title: "A2" } });
  });

  it("asks when both the account and this device hold boards, and keeps everything on request", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("mine", "Films", 1, uids()));
    const { api, keeps } = fakeApi([theirBoard("theirs", "Films")]);
    show(signedIn, { children: null, repository, store, api, now: () => 77 });
    const dialog = await screen.findByRole("dialog", { name: "You’ve used this account before" });
    expect(dialog).toHaveTextContent("It already has 1 board. This device has 1 board");
    expect(keeps).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The clash of names is told apart, both go on living, theirs comes down.
    await waitFor(() => expect(repository.all()).toHaveLength(2));
    expect(repository.get("mine")?.title).toBe("Films (from this device)");
    expect(repository.get("theirs")?.title).toBe("Films");
    await waitFor(() => expect(keeps.map((keep) => keep.uid)).toEqual(["mine"]));
  });

  it("sends this device's boards to the trash when the account's are chosen", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("mine", "Films", 1, uids()));
    const { api } = fakeApi([theirBoard("theirs", "Albums")]);
    show(signedIn, { children: null, repository, store, api, now: () => 77 });
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("radio", { name: /Use only the account/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(repository.get("mine")?.deletedAt).toBe(77));
    await waitFor(() => expect(repository.get("theirs")).not.toBeNull());
  });

  it("switching the back-up off forgets every page of the account's copies, then turns off", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    const { api, forgotten, indexReads } = fakeApi(
      [theirBoard("a", "A"), theirBoard("b", "B"), theirBoard("c", "C")],
      { pageSize: 2 },
    );
    syncRecords(store, "me").markMerged();
    show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(repository.all()).toHaveLength(3));
    indexReads.length = 0;

    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("off"));
    expect(forgotten.sort()).toEqual(["a", "b", "c"]);
    expect(indexReads).toEqual([null, "2"]);
    expect(readBackUp(store)).toBe(false);
    expect(syncRecords(store, "me").all()).toEqual([]);
    // The boards themselves stay: off means the copy is gone, not the boards.
    expect(repository.all()).toHaveLength(3);
  });

  it("a failed delete leaves the switch on, in the store and on screen, with the error to retry", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    const { api } = fakeApi([theirBoard("a", "A")], { refuseForget: true });
    syncRecords(store, "me").markMerged();
    show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(repository.all()).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("failed"));
    expect(screen.getByTestId("probe")).toHaveTextContent("in idle - on");
    expect(readBackUp(store)).toBe(true);
    expect(syncRecords(store, "me").all()).toHaveLength(1);
  });

  it("a run in flight when the account signs out writes nothing more once its answer comes", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("a", "A", 1, uids()));
    const { api, keeps, releaseKeeps } = fakeApi([], { holdKeeps: true });
    const view = show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(keeps).toHaveLength(1));
    expect(screen.getByTestId("probe")).toHaveTextContent("in syncing");

    // The account is gone before the account answers.
    view.rerender(tree(GUEST, { children: null, repository, store, api }));
    expect(screen.getByTestId("probe")).toHaveTextContent("out idle");
    act(releaseKeeps);
    await settle();
    // Nothing of that answer was written down, and nothing else went up.
    expect(syncRecords(store, "me").all()).toEqual([]);
    expect(syncRecords(store, "me").lastSyncedAt()).toBeNull();
    expect(keeps).toHaveLength(1);
  });

  it("switching off waits for the run in flight, and that run writes nothing once the switch moved", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("a", "A", 1, uids()));
    const { api, keeps, forgotten, releaseKeeps } = fakeApi([], { holdKeeps: true });
    show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(keeps).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await settle();
    // Nothing is forgotten while the keep is still in the air: the answer could land after.
    expect(forgotten).toEqual([]);
    expect(screen.getByTestId("probe")).toHaveTextContent("on");

    act(releaseKeeps);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("off"));
    // The copy that keep made is gone with the rest, and the agreement was never written.
    expect(forgotten).toEqual(["a"]);
    expect(syncRecords(store, "me").all()).toEqual([]);
    expect(readBackUp(store)).toBe(false);
    // A change now goes nowhere: the switch is off.
    act(() => repository.save({ ...repository.get("a")!, title: "A2", editedAt: 9 }));
    await settle();
    expect(keeps).toHaveLength(1);
  });
});
