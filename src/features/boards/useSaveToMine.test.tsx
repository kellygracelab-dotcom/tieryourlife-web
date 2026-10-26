import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { saveDraft, scopeOf } from "../board/draft";
import { itemsIn, poolTier, rankedTiers } from "./model";
import { boardsRepository, type BoardsRepository } from "./repository";
import { SaveToMineDialog } from "./SaveToMineDialog";
import { useSaveToMine } from "./useSaveToMine";

const list = (placed: boolean): PublishedList => ({
  id: "L1",
  title: "Albums",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "music",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 9,
  takeCount: 0,
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
  ],
  items: [
    { title: "A", imageUrl: null, tierIndex: placed ? 0 : null },
    { title: "B", imageUrl: null, tierIndex: placed ? 1 : null },
    { title: "C", imageUrl: null, tierIndex: null },
  ],
});

function Harness({
  of,
  repository,
  store,
  notify,
}: {
  of: PublishedList;
  repository: BoardsRepository;
  store: KeyValueStore;
  notify: (notice: SnackbarNotice) => void;
}) {
  const saving = useSaveToMine(of, notify, { repository, store, now: () => 7 });
  return (
    <>
      <button type="button" onClick={saving.start}>
        Save
      </button>
      <SaveToMineDialog saving={saving} />
    </>
  );
}

const show = (of: PublishedList, store: KeyValueStore = memoryStore()) => {
  const repository = boardsRepository(memoryStore());
  const notify = vi.fn<(notice: SnackbarNotice) => void>();
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={<Harness of={of} repository={repository} store={store} notify={notify} />}
        />
        <Route path="/b/:uid" element={<h1>the board</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  return { repository, notify };
};

const titlesIn = (repository: BoardsRepository) => {
  const [board] = repository.all();
  const [s, a] = rankedTiers(board!);
  return {
    s: itemsIn(board!, s!.uid).map((item) => item.title),
    a: itemsIn(board!, a!.uid).map((item) => item.title),
    pool: itemsIn(board!, poolTier(board!)!.uid).map((item) => item.title),
  };
};

describe("useSaveToMine", () => {
  it("saves at once when neither the author nor I placed anything, and offers to open the board", async () => {
    const { repository, notify } = show(list(false));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titlesIn(repository)).toEqual({ s: [], a: [], pool: ["A", "B", "C"] });
    expect(repository.all()[0]).toMatchObject({ title: "Albums", category: "music", editedAt: 7 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ text: "Saved to your lists." }));
    notify.mock.calls[0]![0].action!.onClick();
    expect(await screen.findByRole("heading", { name: "the board" })).toBeInTheDocument();
  });

  it("asks which ranking to keep when there is a choice, and keeps mine when I say so", async () => {
    const store = memoryStore();
    saveDraft(store, scopeOf(list(true)), [[2], []]);
    const { repository } = show(list(true), store);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = screen.getByRole("dialog", { name: "Which ranking to save?" });
    expect(dialog).toHaveTextContent("The author's");
    expect(dialog).toHaveTextContent("Mine");
    // Escape is a change of mind.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(repository.all()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(titlesIn(repository)).toEqual({ s: ["C"], a: [], pool: ["A", "B"] });
  });

  it("offers the author's arrangement against an unranked copy when I placed nothing", async () => {
    const { repository } = show(list(true));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: "Unranked, I'll do it" }));
    expect(titlesIn(repository)).toEqual({ s: [], a: [], pool: ["A", "B", "C"] });
  });
});
