import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { SessionContext } from "../../app/session";
import { keepListRanking, loadListAsWritten } from "../../lib/api";
import { memoryStore } from "../../lib/storage";
import { actionAuth, actionUser, deferred } from "../../test/actionAccount";
import { CopyRankingOffer } from "./CopyRankingOffer";
import { addToPool, newBoard } from "./model";
import { boardFromList } from "./publish";
import { boardsRepository } from "./repository";
import { noteRankingEdit } from "./sourceRanking";
import { boardView } from "./view";

vi.mock("../../lib/api", () => ({ keepListRanking: vi.fn(), loadListAsWritten: vi.fn() }));
vi.mock("../../lib/firebase", () => ({ getFirebaseAuth: () => actionAuth }));

it.each([
  "account during GET",
  "edited board during GET",
  "changed source version",
  "account during PUT",
  "same account",
] as const)(
  "shares only the confirmed copy and records its receipt for the same session: %s",
  async (scenario) => {
    localStorage.clear();
    vi.mocked(loadListAsWritten).mockReset();
    vi.mocked(keepListRanking).mockReset();
    const owner = actionUser("reader");
    actionAuth.currentUser = owner;
    let n = 0;
    const uid = () => String(++n);
    const original = addToPool(
      newBoard("source", "Films", 100, uid),
      [{ title: "Film", imageUrl: null }],
      100,
      uid,
    );
    const source = { ...boardView(original, "Films").list, authorUid: "author" };
    const repo = boardsRepository(memoryStore());
    const copy = boardFromList(source, [[0]], 200, uid);
    repo.save(copy);
    const board = repo.get(copy.uid)!;
    noteRankingEdit(board.uid);
    const fresh = deferred<PublishedList>();
    vi.mocked(loadListAsWritten).mockResolvedValueOnce(source).mockReturnValueOnce(fresh.promise);
    const receipt = deferred<Awaited<ReturnType<typeof keepListRanking>>>();
    vi.mocked(keepListRanking).mockReturnValueOnce(receipt.promise);
    const notify = vi.fn();
    const session = {
      account: { kind: "signedIn" as const, uid: owner.uid, displayName: null, photoUrl: null },
      signIn: vi.fn(),
      signOut: vi.fn(),
      refresh: vi.fn(),
    };
    render(
      <SessionContext.Provider value={session}>
        <CopyRankingOffer board={board} sourceId={source.id} repository={repo} notify={notify} />
      </SessionContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Show in Rankings" }));
    if (scenario === "account during GET") actionAuth.currentUser = actionUser("author");
    if (scenario === "edited board during GET") repo.save({ ...board, title: "Changed" });
    await act(async () =>
      fresh.resolve(
        scenario === "changed source version"
          ? { ...source, updatedAt: source.updatedAt + 1 }
          : source,
      ),
    );
    if (scenario === "account during PUT" || scenario === "same account") {
      expect(keepListRanking).toHaveBeenCalledExactlyOnceWith(
        source,
        source.tiers.map((_, i) => (i === 0 ? [0] : [])),
        expect.objectContaining({ uid: "reader" }),
      );
      if (scenario === "account during PUT") actionAuth.currentUser = actionUser("author");
      await act(async () =>
        receipt.resolve({
          uid: "reader",
          mine: true,
          authorName: "Reader",
          authorPhotoUrl: null,
          rows: [[0]],
          arrangement: [0],
          tierLabels: [],
          updatedAtMs: 1,
        }),
      );
    } else expect(keepListRanking).not.toHaveBeenCalled();
    expect(repo.get(board.uid)?.rankingOf).toBe(scenario === "same account" ? source.id : null);
    expect(repo.get(board.uid)?.rankingChoice).toBe(
      scenario === "same account" ? "ranking" : undefined,
    );
  },
);
