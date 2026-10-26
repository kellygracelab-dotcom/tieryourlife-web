import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
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

const open = (repository: BoardsRepository) =>
  render(
    <MemoryRouter>
      <TrashPage repository={repository} now={() => NOW} />
    </MemoryRouter>,
  );

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
});
