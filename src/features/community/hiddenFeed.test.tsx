import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { ListSummary } from "../../api/types";
import { memoryStore } from "../board/draft";
import { FeedGrid } from "../feed/FeedGrid";
import { HIDDEN_KEY } from "./hidden";
import { useHidden, useHiddenStoreForTests } from "./useHidden";

const list = (id: string, authorUid = "u1"): ListSummary => ({
  id,
  title: `List ${id}`,
  authorUid,
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

function Hider({ id }: { id: string }) {
  const { hideList, hideAuthor } = useHidden();
  return (
    <>
      <button type="button" onClick={() => hideList({ id, title: `List ${id}` })}>
        hide {id}
      </button>
      <button type="button" onClick={() => hideAuthor({ uid: "u2", name: "other" })}>
        hide author
      </button>
    </>
  );
}

const open = (lists: ListSummary[], hiddenNote = false) =>
  render(
    <MemoryRouter>
      <Hider id="a" />
      <FeedGrid
        state={{ status: "ready", lists, next: null, more: "idle", followingNobody: false }}
        label="Feed"
        retry={() => undefined}
        more={() => undefined}
        hiddenNote={hiddenNote}
      />
    </MemoryRouter>,
  );

let store = memoryStore();

beforeEach(() => {
  store = memoryStore();
  useHiddenStoreForTests(store);
});

describe("FeedGrid with hidden lists", () => {
  it("keeps a card hidden during the visit in its place with Undo, and leaves it out after a reload", async () => {
    open([list("a"), list("b")]);
    expect(
      within(screen.getByRole("list", { name: "Feed" })).getAllByRole("listitem"),
    ).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "hide a" }));
    const tile = screen.getByRole("status");
    expect(tile).toHaveTextContent("Hidden for you");
    expect(screen.queryByRole("link", { name: /List a/ })).toBeNull();
    expect(screen.getByRole("link", { name: /List b/ })).toBeInTheDocument();
    expect(store.read(HIDDEN_KEY)).toContain('"a"');

    await userEvent.click(within(tile).getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("link", { name: /List a/ })).toBeInTheDocument();
    expect(store.read(HIDDEN_KEY)).toBeNull();

    // Hidden before this visit: not here at all, and search says so.
    store.write(HIDDEN_KEY, JSON.stringify({ lists: [{ id: "a", title: "List a" }], authors: [] }));
    useHiddenStoreForTests(store);
    open([list("a"), list("b")], true);
    expect(screen.getAllByRole("link", { name: /List b/ })).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: /List a/ })).toBeNull();
    expect(screen.getByText("1 hidden list isn’t shown.")).toBeInTheDocument();
  });

  it("leaves out everything from a hidden author, and says when nothing is left", async () => {
    open([list("c", "u2"), list("d", "u2")]);
    await userEvent.click(screen.getByRole("button", { name: "hide author" }));
    expect(screen.queryByRole("list", { name: "Feed" })).toBeNull();
    expect(screen.getByText(/Everything here is hidden for you/)).toBeInTheDocument();
  });
});
