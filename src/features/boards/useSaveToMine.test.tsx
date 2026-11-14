import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import type { Rows } from "../tierboard/model";
import { itemsIn, liveItems, poolTier, rankedTiers, type Board } from "./model";
import { boardsRepository, type BoardsRepository } from "./repository";
import { useSaveToMine, type Shown } from "./useSaveToMine";

const list = (cover: string | null = null): PublishedList => ({
  id: "L1",
  title: "Albums",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "music",
  itemCount: 3,
  coverImageUrl: cover,
  previewImages: [],
  tierColors: [],
  updatedAt: 9,
  takeCount: 0,
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
  ],
  items: [
    { title: "A", imageUrl: "https://img/a.jpg", tierIndex: 0 },
    { title: "B", imageUrl: null, tierIndex: 1 },
    { title: "C", imageUrl: null, tierIndex: null },
  ],
});

const author = (of: PublishedList): Shown => ({
  whose: "author",
  rows: [[0], [1]],
  tiers: of.tiers,
});
const mine = (of: PublishedList, rows: Rows | null): Shown => ({
  whose: "mine",
  rows,
  tiers: of.tiers,
});

function Harness({
  of,
  shown,
  repository,
  notify,
  take,
}: {
  of: PublishedList;
  shown: Shown;
  repository: BoardsRepository;
  notify: (notice: SnackbarNotice) => void;
  take: () => Promise<void>;
}) {
  const saving = useSaveToMine(of, shown, notify, { repository, now: () => 7, take });
  return (
    <button type="button" onClick={saving.start}>
      {saving.saved ? "Saved" : "Save"}
    </button>
  );
}

function show(of: PublishedList, shown: Shown, repository = boardsRepository(memoryStore())) {
  const notify = vi.fn<(notice: SnackbarNotice) => void>();
  const take = vi.fn(async () => undefined);
  const page = (next: Shown) => (
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Harness of={of} shown={next} repository={repository} notify={notify} take={take} />
          }
        />
        <Route path="/b/:uid" element={<h1>the board</h1>} />
      </Routes>
    </MemoryRouter>
  );
  const { rerender } = render(page(shown));
  return { repository, notify, take, rerender: (next: Shown) => rerender(page(next)) };
}

const titlesIn = (board: Board) => [
  ...rankedTiers(board).map((tier) => itemsIn(board, tier.uid).map((item) => item.title)),
  itemsIn(board, poolTier(board)!.uid).map((item) => item.title),
];

describe("useSaveToMine", () => {
  it("saves the author's arrangement on Author, with the list's cover, and then reads Saved and opens it", async () => {
    const { repository, notify, take } = show(list("https://img/cover.jpg"), author(list()));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const [board] = repository.all();
    expect(titlesIn(board!)).toEqual([["A"], ["B"], ["C"]]);
    expect(board).toMatchObject({
      takenFrom: "L1",
      authorName: "danylo",
      coverImageUrl: "https://img/cover.jpg",
      coverImageUrls: ["https://img/cover.jpg"],
    });
    expect(take).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Saved to your lists.", action: expect.anything() }),
    );
    // No question asked, no second copy: the button opens the board now.
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(screen.getByRole("heading", { name: "the board" })).toBeInTheDocument();
    expect(repository.all()).toHaveLength(1);
  });

  it("leaves a list without a cover to its cards' collage", async () => {
    const { repository } = show(list(), mine(list(), null));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(repository.all()[0]).toMatchObject({ coverImageUrl: null, coverImageUrls: [] });
    expect(titlesIn(repository.all()[0]!)).toEqual([[], [], ["A", "B", "C"]]);
  });

  it("makes one board of a list however often Save is pressed, and puts what is shown on it", async () => {
    const of = list();
    const { repository, notify, take, rerender } = show(of, mine(of, [[2], []]));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(repository.all()).toHaveLength(1);
    const uid = repository.all()[0]!.uid;
    expect(titlesIn(repository.all()[0]!)).toEqual([["C"], [], ["A", "B"]]);
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();

    // Mine moved on: Save again updates the same board, with a way back.
    rerender(mine(of, [[2, 0], [1]]));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(repository.all()).toHaveLength(1);
    expect(repository.all()[0]!.uid).toBe(uid);
    expect(titlesIn(repository.all()[0]!)).toEqual([["C", "A"], ["B"], []]);
    expect(take).toHaveBeenCalledTimes(1);
    const undo = notify.mock.calls.at(-1)![0].action!;
    expect(undo.text).toBe("Undo");
    undo.onClick();
    expect(titlesIn(repository.get(uid)!)).toEqual([["C"], [], ["A", "B"]]);

    // The author's arrangement on the switch goes on the same board too.
    rerender(author(of));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(repository.all()).toHaveLength(1);
    expect(titlesIn(repository.get(uid)!)).toEqual([["A"], ["B"], ["C"]]);
  });

  it("makes no second board on a double click: the second click opens the first", async () => {
    const of = list();
    const { repository, take } = show(of, mine(of, [[2], []]));
    await userEvent.dblClick(screen.getByRole("button", { name: "Save" }));
    expect(repository.all()).toHaveLength(1);
    expect(take).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "the board" })).toBeInTheDocument();
  });

  it("opens a board the person made their own (a card added) rather than putting the list over it", async () => {
    const of = list();
    const { repository, rerender } = show(of, mine(of, [[0], []]));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const board = repository.all()[0]!;
    const pool = poolTier(board)!;
    repository.save({
      ...board,
      items: [
        ...board.items,
        { ...liveItems(board)[0]!, uid: "extra", title: "Mine", tierUid: pool.uid, position: 9 },
      ],
    });
    rerender(author(of));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(screen.getByRole("heading", { name: "the board" })).toBeInTheDocument();
    expect(liveItems(repository.get(board.uid)!)).toHaveLength(4);
  });

  it("reuses a copy already in one's lists, one made on another visit or device", async () => {
    const of = list();
    const first = show(of, author(of));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const repository = first.repository;
    first.rerender(mine(of, [[1], [0]]));
    // A later visit: a fresh page over the same boards.
    const again = show(of, mine(of, [[1], [0]]), repository);
    await userEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);
    expect(repository.all()).toHaveLength(1);
    expect(again.take).not.toHaveBeenCalled();
  });
});
