import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import {
  addToPool,
  liveItems,
  newBoard,
  trashBoard,
  trashItem,
  type Board,
} from "../features/boards/model";
import { boardsRepository, type BoardsRepository } from "../features/boards/repository";
import { memoryStore } from "../lib/storage";
import { TrashPage } from "./TrashPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const HOUR = 3_600_000;
const NOW = 10 * 24 * HOUR;

const films = (): Board => {
  const next = uids();
  return addToPool(
    newBoard("films", "Films", 1, next),
    ["Ex Machina", "The Witch"].map((title) => ({ title, imageUrl: null })),
    1,
    next,
  );
};

const open = (
  repository: BoardsRepository,
  unpublish: (id: string) => Promise<void> = vi.fn(async () => undefined),
) =>
  render(
    <MemoryRouter>
      <TrashPage repository={repository} now={() => NOW} unpublish={unpublish} />
    </MemoryRouter>,
  );

const published = (uid: string, title: string, publishedId: string): Board => ({
  ...trashBoard(newBoard(uid, title, 1, uids()), NOW - HOUR),
  publishedId,
});

const removeForGood = async (title: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Remove ${title} permanently` }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
};

const emptyTrash = async () => {
  await userEvent.click(screen.getByLabelText("More options"));
  await userEvent.click(screen.getByRole("button", { name: "Empty trash" }));
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Empty trash" }),
  );
};

const STILL_PUBLIC =
  "Kept, not deleted: its public copy could not be taken down. Try again when you are online.";

describe("TrashPage", () => {
  it("is empty with no menu to empty it", () => {
    open(boardsRepository(memoryStore()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trash");
    expect(screen.getByText("Nothing in the trash")).toBeInTheDocument();
    expect(screen.queryByLabelText("More options")).toBeNull();
  });

  it("lists deleted boards and cards newest first, each naming where it came from and when", () => {
    const repository = boardsRepository(memoryStore());
    const b = films();
    const [witch] = liveItems(b).filter((item) => item.title === "The Witch");
    repository.saveAll([
      trashItem(b, witch!.uid, NOW - 3 * HOUR),
      trashBoard(newBoard("old", "Albums", 1, uids()), NOW - 2 * 24 * HOUR),
      trashBoard(newBoard("new", "Books", 1, uids()), NOW - 30_000),
    ]);
    open(repository);
    const rows = within(screen.getByRole("list", { name: "Trash" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Books"),
      expect.stringContaining("The Witch"),
      expect.stringContaining("Albums"),
    ]);
    expect(rows[0]).toHaveTextContent("List · 0 cards · deleted just now");
    expect(rows[1]).toHaveTextContent("Item · from Films · deleted 3 h ago");
    expect(rows[2]).toHaveTextContent("List · 0 cards · deleted 2 days ago");
  });

  it("restores without asking, removes for good after asking, and empties after asking", async () => {
    const repository = boardsRepository(memoryStore());
    const b = films();
    const [witch] = liveItems(b).filter((item) => item.title === "The Witch");
    repository.saveAll([
      trashItem(b, witch!.uid, NOW - HOUR),
      trashBoard(newBoard("albums", "Albums", 1, uids()), NOW - HOUR),
      trashBoard(newBoard("books", "Books", 1, uids()), NOW - HOUR),
    ]);
    open(repository);

    await userEvent.click(screen.getByRole("button", { name: "Restore The Witch" }));
    expect(repository.get("films")?.items.every((item) => item.deletedAt === null)).toBe(true);
    expect(screen.queryByText("The Witch")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Remove Albums permanently" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove permanently?");
    expect(dialog).toHaveTextContent("Albums and its 0 cards will be deleted from this device.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(repository.get("albums")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove Albums permanently" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    expect(repository.get("albums")).toBeNull();

    await userEvent.click(screen.getByLabelText("More options"));
    await userEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1 entry will be deleted from this device.",
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Empty trash" }),
    );
    expect(repository.get("books")).toBeNull();
    expect(repository.get("films")).not.toBeNull();
    expect(screen.getByText("Nothing in the trash")).toBeInTheDocument();
  });

  it("asks nothing of the backend for a board that was never published", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([trashBoard(newBoard("albums", "Albums", 1, uids()), NOW - HOUR)]);
    const unpublish = vi.fn(async () => undefined);
    open(repository, unpublish);
    await removeForGood("Albums");
    expect(repository.get("albums")).toBeNull();
    expect(unpublish).not.toHaveBeenCalled();
  });

  it("takes a published board's list down before removing it for good, and an already gone one is down", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([
      published("albums", "Albums", "pub-a"),
      published("books", "Books", "pub-b"),
    ]);
    const unpublish = vi
      .fn<(id: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" }));
    open(repository, unpublish);
    await removeForGood("Albums");
    expect(unpublish).toHaveBeenLastCalledWith("pub-a");
    expect(repository.get("albums")).toBeNull();
    await removeForGood("Books");
    expect(unpublish).toHaveBeenLastCalledWith("pub-b");
    expect(repository.get("books")).toBeNull();
    expect(screen.queryByText(STILL_PUBLIC)).toBeNull();
  });

  it("keeps a board in the trash, and says so, when its list could not be taken down", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([published("albums", "Albums", "pub-a")]);
    const unpublish = vi.fn(async () => Promise.reject(new ApiFailure({ kind: "offline" })));
    open(repository, unpublish);
    await removeForGood("Albums");
    expect(unpublish).toHaveBeenCalledWith("pub-a");
    expect(repository.get("albums")).not.toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent(STILL_PUBLIC);
    expect(screen.getByRole("button", { name: "Remove Albums permanently" })).toBeEnabled();
  });

  it("empties all but a board whose list is still out there, which stays for the next try", async () => {
    const repository = boardsRepository(memoryStore());
    const b = films();
    const [witch] = liveItems(b).filter((item) => item.title === "The Witch");
    repository.saveAll([
      trashItem(b, witch!.uid, NOW - HOUR),
      trashBoard(newBoard("albums", "Albums", 1, uids()), NOW - HOUR),
      published("books", "Books", "pub-b"),
      published("games", "Games", "pub-g"),
    ]);
    const unpublish = vi.fn(async (id: string) =>
      id === "pub-g" ? Promise.reject(new Error("down")) : undefined,
    );
    open(repository, unpublish);
    await emptyTrash();
    expect(unpublish.mock.calls.map(([id]) => id).sort()).toEqual(["pub-b", "pub-g"]);
    expect(repository.get("albums")).toBeNull();
    expect(repository.get("books")).toBeNull();
    expect(repository.get("games")).not.toBeNull();
    expect(repository.get("films")?.items.map((item) => item.title)).toEqual(["Ex Machina"]);
    expect(await screen.findByRole("status")).toHaveTextContent(STILL_PUBLIC);
    const rows = within(screen.getByRole("list", { name: "Trash" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Games")]);
  });

  it("says nothing once every list in the trash came down", async () => {
    const repository = boardsRepository(memoryStore());
    repository.saveAll([published("books", "Books", "pub-b")]);
    open(repository);
    await emptyTrash();
    expect(repository.get("books")).toBeNull();
    expect(screen.getByText("Nothing in the trash")).toBeInTheDocument();
    expect(screen.queryByText(STILL_PUBLIC)).toBeNull();
  });
});
