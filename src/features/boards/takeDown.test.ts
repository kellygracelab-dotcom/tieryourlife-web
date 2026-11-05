import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import { newBoard } from "./model";
import { takenDown, unpublished } from "./takeDown";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

describe("a board's public copy on its way to the trash", () => {
  it("takes a ranking down from the list it ranks, never that list", async () => {
    const board = { ...newBoard("b", "Films", 1, uids()), rankingOf: "SRC" };
    const unpublish = vi.fn(() => Promise.resolve());
    const withdraw = vi.fn(() => Promise.resolve());
    expect(await takenDown(board, unpublish, withdraw)).toBe(true);
    expect(withdraw).toHaveBeenCalledExactlyOnceWith("SRC");
    expect(unpublish).not.toHaveBeenCalled();
    expect(unpublished(board, 9)).toMatchObject({ rankingOf: null, publishedId: null });
  });

  it("keeps the board when the ranking could not be taken down", async () => {
    const board = { ...newBoard("b", "Films", 1, uids()), rankingOf: "SRC" };
    const offline = () => Promise.reject(new ApiFailure({ kind: "offline" }));
    expect(await takenDown(board, vi.fn(), offline)).toBe(false);
  });
});
