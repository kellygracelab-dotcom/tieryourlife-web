import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KeepBoardRequest, KeptBoard } from "../../api/boards";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import type { SignInOutcome } from "../../lib/signIn";
import { memoryStore } from "../../lib/storage";
import { boardOwners } from "./owners";
import { readBackUp } from "./syncRecords";
import { BoardSyncProvider } from "./BoardSyncProvider";
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
const other: Account = { kind: "signedIn", uid: "other", displayName: "O", photoUrl: null };

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
  options: {
    pageSize?: number;
    holdKeeps?: boolean;
    holdForgets?: boolean;
    /** Index reads answered at once before the rest are held back. */
    holdIndexAfter?: number;
    refuseForget?: boolean;
  } = {},
) {
  const {
    pageSize = 50,
    holdKeeps = false,
    holdForgets = false,
    holdIndexAfter = Infinity,
    refuseForget = false,
  } = options;
  const kept = new Map(theirs.map((board) => [board.uid, board]));
  const keeps: { uid: string; request: KeepBoardRequest }[] = [];
  const forgotten: string[] = [];
  const indexReads: (string | null)[] = [];
  // Answers held back until the test lets them go, in the order they were asked.
  const held = {
    keeps: [] as (() => void)[],
    forgets: [] as (() => void)[],
    index: [] as (() => void)[],
  };
  const page = (after: string | null) => {
    const all = [...kept.values()];
    const start = after === null ? 0 : Number(after);
    const slice = all.slice(start, start + pageSize);
    return {
      boards: slice.map((board) => ({
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
    };
  };
  const api: BoardsApi = {
    index: (after) => {
      indexReads.push(after);
      if (indexReads.length <= holdIndexAfter) return Promise.resolve(page(after));
      const gate = deferred<ReturnType<typeof page>>();
      held.index.push(() => gate.resolve(page(after)));
      return gate.promise;
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
      held.keeps.push(() => gate.resolve(answer()));
      return gate.promise;
    },
    forget: (uid) => {
      if (refuseForget) return Promise.reject(new Error("the account would not"));
      const answer = () => {
        forgotten.push(uid);
        const was = kept.get(uid);
        if (was !== undefined) kept.set(uid, { ...was, deleted: true, revision: was.revision + 1 });
      };
      if (!holdForgets) {
        answer();
        return Promise.resolve();
      }
      const gate = deferred<void>();
      held.forgets.push(() => gate.resolve(answer()));
      return gate.promise;
    },
    published: () => Promise.resolve([]),
  };
  const release = (which: keyof typeof held) => () => {
    for (const go of held[which].splice(0)) go();
  };
  return {
    api,
    keeps,
    kept,
    forgotten,
    indexReads,
    releaseKeeps: release("keeps"),
    releaseForgets: release("forgets"),
    releaseIndex: release("index"),
  };
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
        {sync.signedIn ? "in" : "out"} {sync.status} - {sync.backUp ? "on" : "off"}
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

    act(() => repository.save({ ...repository.get("a")!, title: "A2", editedAt: 5 }));
    await waitFor(() => expect(keeps).toHaveLength(2));
    expect(keeps[1]).toMatchObject({ uid: "a", request: { basedOn: 1, title: "A2" } });
  });

  it("brings the account's boards to a new device on sign-in when mounted twice, as StrictMode does", async () => {
    // StrictMode mounts, unmounts and mounts again: the first run is cancelled
    // with its mount, and the run the second mount asked for meanwhile must
    // still happen. It was dropped, and a second device came up empty.
    const store = memoryStore();
    const repository = boardsRepository(store);
    const { api, indexReads } = fakeApi([theirBoard("theirs", "Films")]);
    render(<StrictMode>{tree(signedIn, { children: null, repository, store, api })}</StrictMode>);
    await waitFor(() => expect(repository.get("theirs")?.title).toBe("Films"));
    expect(indexReads.length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("in idle -"));
  });

  it("lets a change to the game alone wait for the longer pause, an edit going up soon", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("a", "A", 1, uids()));
    const { api, keeps } = fakeApi();
    render(
      <SessionContext.Provider value={sessionOf(signedIn)}>
        <BoardSyncProvider
          repository={repository}
          store={store}
          api={api}
          syncAfterMs={10}
          // Long enough that a loaded machine's few settles never reach it.
          playSyncAfterMs={1000}
          resolvePicture={() => () => Promise.resolve(null)}
        >
          <Probe />
        </BoardSyncProvider>
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(keeps).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("in idle -"));

    const play = {
      kind: "hill" as const,
      count: 3,
      seed: 1,
      refine: false,
      ids: ["x", "y", "z"],
      history: [[0, 1, 0] as [number, number, number | null]],
      round: 0,
      startedAt: 1,
    };
    act(() => repository.save({ ...repository.get("a")!, play }));
    await settle();
    act(() => repository.save({ ...repository.get("a")!, play: { ...play, history: [] } }));
    await settle();
    expect(keeps).toHaveLength(1);
    await waitFor(() => expect(keeps).toHaveLength(2), { timeout: 3000 });

    act(() => repository.save({ ...repository.get("a")!, title: "A2", editedAt: 5 }));
    await settle();
    expect(keeps).toHaveLength(3);
  });

  it("asks after signing into an account used before, and moves the boards made without one in", async () => {
    const store = memoryStore();
    const owners = boardOwners(store);
    owners.arrived({ owner: null, guestUid: "guest" });
    owners.boards.save(newBoard("mine", "Films", 1, uids()));
    owners.arrived({ owner: "me", guestUid: null });
    const { api, keeps } = fakeApi([theirBoard("theirs", "Films")]);
    show(signedIn, { children: null, owners, store, api });
    const dialog = await screen.findByRole("dialog", { name: "Lists made without an account" });
    expect(dialog).toHaveTextContent("This browser has 1 list made without an account");
    // Only the account's own boards go up meanwhile: none of them is the guest's.
    await waitFor(() => expect(owners.of("me").get("theirs")).not.toBeNull());
    expect(keeps).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Move them into your account" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The clash of names is told apart, both go on living, and the moved one goes up.
    expect(owners.of(null).all()).toEqual([]);
    expect(owners.of("me").get("mine")?.title).toBe("Films (from this device)");
    await waitFor(() => expect(keeps.map((keep) => keep.uid)).toEqual(["mine"]));
  });

  it("keeps the boards made without an account in this browser on request", async () => {
    const store = memoryStore();
    const owners = boardOwners(store);
    owners.arrived({ owner: null, guestUid: "guest" });
    owners.boards.save(newBoard("mine", "Films", 1, uids()));
    owners.arrived({ owner: "me", guestUid: null });
    const { api, keeps } = fakeApi();
    show(signedIn, { children: null, owners, store, api });
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Keep them in this browser only" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(owners.of(null).get("mine")).not.toBeNull();
    expect(owners.of("me").all()).toEqual([]);
    await settle();
    expect(keeps).toEqual([]);
  });

  it("switching the back-up off forgets every page of the account's copies, then turns off", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    const { api, forgotten, indexReads } = fakeApi(
      [theirBoard("a", "A"), theirBoard("b", "B"), theirBoard("c", "C")],
      { pageSize: 2 },
    );
    show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(repository.all()).toHaveLength(3));
    // The boards coming down are changes too, and ask for one more run after
    // the debounce; it finds both sides agreeing. Only then are reads counted.
    await waitFor(() => expect(syncRecords(store, "me").all()).toHaveLength(3));
    await settle();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("in idle"));
    indexReads.length = 0;

    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("off"));
    expect(forgotten.sort()).toEqual(["a", "b", "c"]);
    expect(indexReads).toEqual([null, "2"]);
    expect(readBackUp(store, "me")).toBe(false);
    expect(syncRecords(store, "me").all()).toEqual([]);
    // The boards themselves stay: off means the copy is gone, not the boards.
    expect(repository.all()).toHaveLength(3);
  });

  it("a failed delete leaves the switch on, in the store and on screen, with the error to retry", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    const { api } = fakeApi([theirBoard("a", "A")], { refuseForget: true });
    show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(repository.all()).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("failed"));
    expect(screen.getByTestId("probe")).toHaveTextContent("in idle - on");
    expect(readBackUp(store, "me")).toBe(true);
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

  it("a run in flight when another account signs in writes nothing of the first, and the second runs on its own", async () => {
    const store = memoryStore();
    const repository = boardsRepository(store);
    repository.save(newBoard("a", "A", 1, uids()));
    const { api, keeps, releaseKeeps } = fakeApi([], { holdKeeps: true });
    const view = show(signedIn, { children: null, repository, store, api });
    await waitFor(() => expect(keeps).toHaveLength(1));

    view.rerender(tree(other, { children: null, repository, store, api }));
    // The second account starts its own run over the same boards; both answers come back.
    await waitFor(() => expect(keeps).toHaveLength(2));
    act(releaseKeeps);
    await waitFor(() => expect(syncRecords(store, "other").all()).toHaveLength(1));
    expect(syncRecords(store, "me").all()).toEqual([]);
    expect(syncRecords(store, "me").lastSyncedAt()).toBeNull();
    expect(screen.getByTestId("probe")).toHaveTextContent("in idle - on");
  });

  it("switching off stops after the answer in flight when another account signs in meanwhile", async () => {
    const store = memoryStore();
    // Each account has its own boards here: the second one's run fills its own.
    const owners = boardOwners(store);
    const repository = owners.of("me");
    const { api, forgotten, releaseForgets } = fakeApi(
      [theirBoard("a", "A"), theirBoard("b", "B"), theirBoard("c", "C")],
      { holdForgets: true },
    );
    const view = show(signedIn, { children: null, owners, store, api });
    await waitFor(() => expect(repository.all()).toHaveLength(3));

    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await settle();
    view.rerender(tree(other, { children: null, owners, store, api }));
    act(releaseForgets);
    await settle();
    // The first forget had gone out as the first account; its answer is written down for
    // that account, and nothing more is asked. The device's switch stays on.
    expect(forgotten).toEqual(["a"]);
    expect(
      syncRecords(store, "me")
        .all()
        .map((record) => record.uid),
    ).toEqual(["b", "c"]);
    expect(readBackUp(store, "me")).toBe(true);
    expect(repository.all()).toHaveLength(3);
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
    expect(readBackUp(store, "me")).toBe(false);
    // A change now goes nowhere: the switch is off.
    act(() => repository.save({ ...repository.get("a")!, title: "A2", editedAt: 9 }));
    await settle();
    expect(keeps).toHaveLength(1);
  });
});
