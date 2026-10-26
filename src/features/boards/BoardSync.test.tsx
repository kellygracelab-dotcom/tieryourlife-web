import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KeepBoardRequest, KeptBoard } from "../../api/boards";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import type { SignInOutcome } from "../../lib/signIn";
import { memoryStore } from "../../lib/storage";
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

function fakeApi(theirs: KeptBoard[] = []) {
  const kept = new Map(theirs.map((board) => [board.uid, board]));
  const keeps: { uid: string; request: KeepBoardRequest }[] = [];
  const api: BoardsApi = {
    index: () =>
      Promise.resolve({
        boards: [...kept.values()].map((board) => ({
          uid: board.uid,
          revision: board.revision,
          updatedAt: board.updatedAt,
          deviceName: board.deviceName,
          deleted: board.deleted,
          fingerprint: board.fingerprint,
          title: board.title,
          itemCount: board.items.length,
        })),
        next: null,
      }),
    board: (uid) => Promise.resolve(kept.get(uid)!),
    keep: (uid, request) => {
      keeps.push({ uid, request });
      const revision = (kept.get(uid)?.revision ?? 0) + 1;
      kept.set(uid, { ...request, uid, revision, updatedAt: 1, deleted: false });
      return Promise.resolve({ uid, revision });
    },
    forget: () => Promise.resolve(),
    published: () => Promise.resolve([]),
  };
  return { api, keeps, kept };
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
  return (
    <p data-testid="probe">
      {sync.signedIn ? "in" : "out"} {sync.status} {sync.merge === null ? "-" : "asking"}
    </p>
  );
}

const show = (account: Account, deps: Parameters<typeof BoardSyncProvider>[0]) => {
  const session: Session = {
    account,
    signIn: () => new Promise<SignInOutcome>(() => undefined),
    signOut: () => Promise.resolve(),
    refresh: () => undefined,
  };
  return render(
    <SessionContext.Provider value={session}>
      <BoardSyncProvider
        {...deps}
        syncAfterMs={10}
        resolvePicture={() => () => Promise.resolve(null)}
      >
        <Probe />
      </BoardSyncProvider>
    </SessionContext.Provider>,
  );
};

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
});
