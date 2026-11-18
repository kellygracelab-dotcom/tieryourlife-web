import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StartedList } from "../../api/started";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import { memoryStore } from "../../lib/storage";
import { siteNotice, sayOnTheSite } from "../../ui/siteNotice";
import { boardsRepository } from "../boards/repository";
import { draftKey } from "../tierboard/draft";
import { startedChanged } from "./started";
import { StartedSync } from "./StartedSyncRunner";
import type { StartedApi } from "./startedSync";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const me: Account = { kind: "signedIn", uid: "me", displayName: "D", photoUrl: null };

const sessionOf = (account: Account | null): Session => ({
  account,
  signIn: () => Promise.resolve({ kind: "failed", code: "test" }),
  signOut: () => Promise.resolve(),
  refresh: () => undefined,
});

const phoneList = (rows: number[][], updatedAt: number, changedAt: number): StartedList => ({
  listId: "got",
  updatedAt,
  changedAt,
  listVersion: 7,
  itemCount: 45,
  tierCount: rows.length,
  title: "Game of Thrones characters",
  picture: null,
  pictures: [],
  category: "film_tv",
  rows,
  placed: rows.flat().length,
  play: null,
});

function fakeApi(page: StartedList[]) {
  const calls: string[] = [];
  const api: StartedApi = {
    load: (since) => {
      calls.push(`GET ${since ?? ""}`);
      return Promise.resolve({ started: page.splice(0), removed: [], now: 0 });
    },
    keep: (listId, _content, basedOn) => {
      calls.push(`PUT ${listId} ${basedOn}`);
      return Promise.resolve({ updatedAt: 100 });
    },
    forget: (listId, reason) => {
      calls.push(`DELETE ${listId} ${reason}`);
      return Promise.resolve({ updatedAt: 101 });
    },
  };
  return { api, calls, page };
}

function show(account: Account, api: StartedApi, store = memoryStore()) {
  render(
    <SessionContext.Provider value={sessionOf(account)}>
      <StartedSync
        store={store}
        api={api}
        repository={boardsRepository(memoryStore())}
        soonMs={0}
        checkMs={20}
      />
    </SessionContext.Provider>,
  );
  return store;
}

describe("Continue with the account", () => {
  it("brings in on sign-in what the phone began, and says so only when it replaced a version here", async () => {
    sayOnTheSite(null);
    const server = fakeApi([phoneList([[3, 7], [1], [], [12], []], 5, 10)]);
    const store = show(me, server.api);
    await waitFor(() => expect(store.read(draftKey("got"))).not.toBeNull());
    expect(JSON.parse(store.read(draftKey("got"))!)).toMatchObject({
      rows: [[3, 7], [1], [], [12], []],
    });
    expect(siteNotice()).toBeNull();
    // A change on the phone over the version shown here.
    server.page.push(phoneList([[3, 7, 9], [1], [], [12], []], 6, 20));
    act(() => startedChanged(true));
    await waitFor(() => expect(siteNotice()?.text).toBe("Updated from another device"));
  });

  it("sends a change made here soon after it", async () => {
    const server = fakeApi([]);
    const store = show(me, server.api);
    await waitFor(() => expect(server.calls).toEqual(["GET "]));
    store.write(
      draftKey("a"),
      JSON.stringify({
        listId: "a",
        updatedAt: 1,
        itemCount: 5,
        title: "A",
        savedAt: 1,
        rows: [[0], []],
      }),
    );
    await waitFor(() => expect(server.calls).toContain("PUT a null"));
  });

  it("asks nothing of the account for a guest", async () => {
    const server = fakeApi([]);
    show(GUEST, server.api);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(server.calls).toEqual([]);
  });
});
