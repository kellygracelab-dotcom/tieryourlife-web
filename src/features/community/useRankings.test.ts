import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { ApiFailure } from "../../api/errors";
import { likeTroubleOf, PAGES_READ_ON, useRankings, type RankingsDeps } from "./useRankings";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const reader = (uid: string): ReaderRanking => ({
  uid,
  authorName: uid,
  authorPhotoUrl: null,
  arrangement: [0],
  rows: [[0]],
  tierLabels: [],
  updatedAtMs: 0,
  mine: false,
});

const noLike = vi.fn(async () => ({ likedByMe: false }));

describe("useRankings", () => {
  it("reads on past a page that came back empty with more behind it", async () => {
    const pages: Record<string, RankingsPage> = {
      first: { rankings: [], nextCursor: "c1" },
      c1: { rankings: [], nextCursor: "c2" },
      c2: { rankings: [reader("kenji")], nextCursor: null },
    };
    const load = vi.fn(async (_list: string, after: string | null) => pages[after ?? "first"]!);
    const deps = { load, withdraw: vi.fn(async () => undefined), like: noLike } as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.rankings.map((ranking) => ranking.uid)).toEqual(["kenji"]);
    expect(load.mock.calls.map((call) => call[1])).toEqual([null, "c1", "c2"]);
  });
  it("reads again from the top when the reader a page ended at is gone, keeping the rows", async () => {
    const load = vi.fn(async (_list: string, after: string | null): Promise<RankingsPage> => {
      if (after === null) return { rankings: [reader("a"), reader("b")], nextCursor: "b" };
      if (after === "b") throw new ApiFailure({ kind: "cursorGone" });
      return { rankings: [reader("c")], nextCursor: null };
    });
    const deps = { load, withdraw: vi.fn(async () => undefined), like: noLike } as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // b withdrew: the top now ends at a, and the page after it brings c.
    load.mockImplementation(async (_list, after) =>
      after === null
        ? { rankings: [reader("a")], nextCursor: "a" }
        : after === "a"
          ? { rankings: [reader("c")], nextCursor: null }
          : Promise.reject(new ApiFailure({ kind: "cursorGone" })),
    );
    act(() => result.current.more());
    await waitFor(() => expect(result.current.state.next).toBeNull());
    expect(result.current.state.rankings.map((ranking) => ranking.uid)).toEqual(["a", "b", "c"]);
    expect(result.current.state.more).toBe("idle");
    expect(load.mock.calls.map((call) => call[1])).toEqual([null, "b", null, "a"]);
  });

  it("reads only a few empty pages on its own, never the same cursor twice, and no field is the end", async () => {
    const stuck = vi.fn(async (): Promise<RankingsPage> => ({ rankings: [], nextCursor: "s" }));
    const deps = { load: stuck, withdraw: vi.fn(async () => undefined), like: noLike };
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // null, then "s" once: "s" again would never end.
    expect(stuck).toHaveBeenCalledTimes(2);
    expect(result.current.state.next).toBeNull();

    let n = 0;
    const endless = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [],
      nextCursor: `c${++n}`,
    }));
    const more = renderHook(() =>
      useRankings("l2", { load: endless, withdraw: vi.fn(async () => undefined), like: noLike }),
    );
    act(() => more.result.current.open());
    await waitFor(() => expect(more.result.current.state.status).toBe("ready"));
    expect(endless).toHaveBeenCalledTimes(PAGES_READ_ON + 1);
    // Show more is offered again rather than read on for ever.
    expect(more.result.current.state.next).toBe(`c${PAGES_READ_ON + 1}`);

    const bare = vi.fn(async () => ({ rankings: [reader("a")] }) as unknown as RankingsPage);
    const old = renderHook(() =>
      useRankings("l3", { load: bare, withdraw: vi.fn(async () => undefined), like: noLike }),
    );
    act(() => old.result.current.open());
    await waitFor(() => expect(old.result.current.state.status).toBe("ready"));
    expect(old.result.current.state.next).toBeNull();
  });

  it("lists a reader once when a page names them twice", async () => {
    const load = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [reader("a"), reader("b"), { ...reader("a"), authorName: "a again" }],
      nextCursor: null,
    }));
    const deps = { load, withdraw: vi.fn(async () => undefined), like: noLike } as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.rankings.map((ranking) => ranking.authorName)).toEqual(["a", "b"]);
  });

  // QA W51: the count follows the server through Show, Withdraw and Show again.
  it("takes one's own off the count when withdrawn, back on when it fails, and adds a new one", async () => {
    const withdraw = vi.fn(async () => undefined);
    const load = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [{ ...reader("me"), mine: true }, reader("b")],
      nextCursor: null,
    }));
    const { result } = renderHook(() => useRankings("l1", { load, withdraw, like: noLike }));
    // Shown before the sheet was read: counted, nothing listed yet.
    act(() => result.current.put({ ...reader("me"), created: true }));
    expect(result.current.state.countChange).toBe(1);
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => result.current.withdraw());
    expect(result.current.state.countChange).toBe(0);
    // Shown again: a new one on the server, whose place only the server knows.
    act(() => result.current.put({ ...reader("me"), created: true }));
    expect(result.current.state.countChange).toBe(1);
    expect(result.current.state.status).toBe("idle");
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // Changed in place: no new reader.
    act(() => result.current.put({ ...reader("me"), created: false }));
    expect(result.current.state.countChange).toBe(1);
    withdraw.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    act(() => result.current.withdraw());
    expect(result.current.state.countChange).toBe(0);
    await waitFor(() => expect(result.current.state.withdrawFailed).toBe(true));
    expect(result.current.state.countChange).toBe(1);
  });

  it("keeps the server's order, leaves the author's to the list, and one's own in its place", async () => {
    const load = vi.fn(async (_list: string, after: string | null): Promise<RankingsPage> =>
      after === null
        ? {
            rankings: [
              { ...reader(""), isAuthor: true },
              reader("liked"),
              { ...reader("me"), mine: true },
              reader("old"),
            ],
            nextCursor: "p2",
          }
        : {
            rankings: [reader("old"), reader("z"), { ...reader("me"), mine: true }],
            nextCursor: null,
          },
    );
    const { result } = renderHook(() =>
      useRankings("l1", { load, withdraw: vi.fn(async () => undefined), like: noLike }),
    );
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.rankings.map((r) => r.uid)).toEqual(["liked", "me", "old"]);
    act(() => result.current.more());
    await waitFor(() => expect(result.current.state.next).toBeNull());
    // Each reader once, in the order the pages came.
    expect(result.current.state.rankings.map((r) => r.uid)).toEqual(["liked", "me", "old", "z"]);
  });

  it("puts one's own back where it was when a withdrawal fails", async () => {
    const withdraw = vi.fn(async () => Promise.reject(new ApiFailure({ kind: "offline" })));
    const load = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [reader("a"), { ...reader("me"), mine: true }, reader("b")],
      nextCursor: null,
    }));
    const { result } = renderHook(() => useRankings("l1", { load, withdraw, like: noLike }));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => result.current.withdraw());
    expect(result.current.state.rankings.map((r) => r.uid)).toEqual(["a", "b"]);
    await waitFor(() => expect(result.current.state.withdrawFailed).toBe(true));
    expect(result.current.state.rankings.map((r) => r.uid)).toEqual(["a", "me", "b"]);
  });

  it("changes one's own in place when it is shown again", async () => {
    const load = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [reader("a"), { ...reader("me"), mine: true }, reader("b")],
      nextCursor: null,
    }));
    const { result } = renderHook(() =>
      useRankings("l1", { load, withdraw: vi.fn(async () => undefined), like: noLike }),
    );
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => result.current.put({ ...reader("me"), rows: [[1]], created: false }));
    expect(result.current.state.rankings.map((r) => r.uid)).toEqual(["a", "me", "b"]);
    expect(result.current.state.rankings[1]).toMatchObject({ mine: true, rows: [[1]] });
  });
});

describe("likes", () => {
  const opened = async (like: RankingsDeps["like"]) => {
    const load = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [
        { ...reader(""), isAuthor: true },
        reader("ana"),
        { ...reader("bo"), likedByMe: true },
        { ...reader("me"), mine: true },
      ],
      nextCursor: null,
    }));
    const hook = renderHook(() =>
      useRankings("l1", { load, withdraw: vi.fn(async () => undefined), like }),
    );
    act(() => hook.result.current.open());
    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    return hook;
  };
  const liked = (state: { rankings: ReaderRanking[] }, uid: string) =>
    state.rankings.find((r) => r.uid === uid)?.likedByMe;

  it("likes at once and unlikes on a second press, as the server answers", async () => {
    const like = vi.fn(async (_l: string, _u: string, to: boolean) => ({ likedByMe: to }));
    const { result } = await opened(like);
    act(() => result.current.like("ana"));
    expect(liked(result.current.state, "ana")).toBe(true);
    await waitFor(() => expect(like).toHaveBeenCalledWith("l1", "ana", true));
    act(() => result.current.like("bo"));
    expect(liked(result.current.state, "bo")).toBe(false);
    expect(like).toHaveBeenLastCalledWith("l1", "bo", false);
    await waitFor(() => expect(liked(result.current.state, "bo")).toBe(false));
  });

  it("never likes one's own", async () => {
    const like = vi.fn(async () => ({ likedByMe: true }));
    const { result } = await opened(like);
    act(() => result.current.like("me"));
    act(() => result.current.like("nobody"));
    expect(like).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiFailure({ kind: "notSignedIn" }), { kind: "signIn" }],
    [new ApiFailure({ kind: "banned", until: 5 }), { kind: "banned", until: 5 }],
    [new ApiFailure({ kind: "likeLimit", retryAt: 9 }), { kind: "limit", retryAt: 9 }],
    [new ApiFailure({ kind: "likeLimit" }), { kind: "limit", retryAt: null }],
    [new ApiFailure({ kind: "offline" }), { kind: "failed" }],
    [new ApiFailure({ kind: "cannotLike" }), null],
  ])("takes the like back when it is refused: %s", async (failure, trouble) => {
    const like = vi.fn(async () => Promise.reject(failure));
    const { result } = await opened(like);
    act(() => result.current.like("ana"));
    expect(liked(result.current.state, "ana")).toBe(true);
    await waitFor(() => expect(liked(result.current.state, "ana")).toBe(false));
    expect(result.current.state.likeTrouble).toEqual(
      trouble === null ? null : { uid: "ana", ...trouble },
    );
    expect(result.current.state.gone).toEqual([]);
  });

  it("says a ranking that is gone is gone, and offers no more likes on it", async () => {
    const like = vi.fn(async () => Promise.reject(new ApiFailure({ kind: "notFound" })));
    const { result } = await opened(like);
    act(() => result.current.like("bo"));
    await waitFor(() => expect(result.current.state.gone).toEqual(["bo"]));
    expect(liked(result.current.state, "bo")).toBe(true);
    expect(result.current.state.likeTrouble).toEqual({ uid: "bo", kind: "gone" });
    act(() => result.current.like("bo"));
    expect(like).toHaveBeenCalledTimes(1);
  });

  it("lets only the last press's answer count", async () => {
    let fail: (reason: unknown) => void = () => undefined;
    const like = vi
      .fn<RankingsDeps["like"]>()
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockImplementationOnce(async () => ({ likedByMe: false }));
    const { result } = await opened(like);
    act(() => result.current.like("ana"));
    act(() => result.current.like("ana"));
    await waitFor(() => expect(like).toHaveBeenCalledTimes(2));
    await act(async () => fail(new ApiFailure({ kind: "offline" })));
    expect(liked(result.current.state, "ana")).toBe(false);
    expect(result.current.state.likeTrouble).toBeNull();
  });

  it("asks a guest to sign in beside the ranking, and forgets it on request", async () => {
    const { result } = await opened(noLike);
    act(() => result.current.askSignIn("ana"));
    expect(result.current.state.likeTrouble).toEqual({ uid: "ana", kind: "signIn" });
    act(() => result.current.dismissTrouble());
    expect(result.current.state.likeTrouble).toBeNull();
  });

  it("reads a refusal the way the sheet says it", () => {
    expect(likeTroubleOf("a", { kind: "unauthenticated" })).toEqual({ uid: "a", kind: "signIn" });
    expect(likeTroubleOf("a", { kind: "notFound" })).toEqual({ uid: "a", kind: "gone" });
    expect(likeTroubleOf("a", { kind: "conflict" })).toBeNull();
  });
});
