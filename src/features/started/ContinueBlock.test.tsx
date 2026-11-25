import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { boardsRepository } from "../boards/repository";
import { EVERYTHING } from "../play/chosen";
import { newGame } from "../play/game";
import { encodeGame, playKey } from "../play/savedGames";
import { draftKey } from "../tierboard/draft";
import { ContinueBlock } from "./ContinueBlock";
import { wantsResume, wantsSave } from "./started";
import type { SnackbarNotice } from "../../ui/Snackbar";

function begin(
  store: KeyValueStore,
  id: string,
  title: string,
  placed: number,
  extra: Record<string, unknown> = {},
) {
  store.write(
    draftKey(id),
    JSON.stringify({
      listId: id,
      updatedAt: 1,
      itemCount: 10,
      title,
      picture: null,
      savedAt: Date.now(),
      rows: [Array.from({ length: placed }, (_, i) => i)],
      ...extra,
    }),
  );
}

function ListStub() {
  const location = useLocation();
  return (
    <p>
      {wantsResume(location.state) ? "resuming" : wantsSave(location.state) ? "saving" : "opened"}
    </p>
  );
}

function show(store: KeyValueStore, onNotice?: (notice: SnackbarNotice) => void) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ContinueBlock
            store={store}
            repository={boardsRepository(memoryStore())}
            {...(onNotice === undefined ? {} : { onNotice })}
          />
        ),
      },
      { path: "/l/:id", element: <ListStub /> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

// jsdom has no PointerEvent, so a mouse event carries the pointer type and finger by hand.
function finger(type: string, target: Element, x: number, y = 100, pointerType = "touch") {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: 3 });
  fireEvent(target, event);
}

/** A row 300 px wide, its finger moved from 150 to `to` and lifted there. */
function swipe(row: Element, to: number, y = 100, pointerType = "touch") {
  row.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
  finger("pointerdown", row, 150, 100, pointerType);
  finger("pointermove", row, (150 + to) / 2, y, pointerType);
  finger("pointermove", row, to, y, pointerType);
  finger("pointerup", row, to, y, pointerType);
}

const rowOf = (title: string) => screen.getByText(title).closest("li")!;

describe("Continue", () => {
  it("says nothing while nothing is begun", () => {
    show(memoryStore());
    expect(screen.queryByRole("region", { name: /Continue/ })).toBeNull();
  });

  it("leads back into a begun list, and straight into its saved game", async () => {
    const store = memoryStore();
    begin(store, "a24", "Every A24 film", 3, { category: "film_tv" });
    store.write(
      playKey("list:a24"),
      encodeGame(newGame("hill", ["0", "1", "2"], EVERYTHING, 1, Date.now()), Date.now()),
    );
    show(store);
    // A group's label with the count, the list's section and how far it is (artboard 14).
    const block = within(screen.getByRole("region", { name: "Continue · 1" }));
    expect(block.getByText("Every A24 film")).toBeInTheDocument();
    // On one line, the section giving way when short of room; the whole in its title (artboard 46).
    expect(block.getByTitle("Film & TV · 3 of 10 placed")).toHaveTextContent(
      "Film & TV · 3 of 10 placed",
    );
    expect(block.getByRole("link", { name: "Continue “Every A24 film”" })).toHaveAttribute(
      "href",
      "/l/a24",
    );
    block.getByRole("link", { name: "Resume game" }).click();
    expect(await screen.findByText("resuming")).toBeInTheDocument();
  });

  it("offers no Resume game without a saved game", () => {
    const store = memoryStore();
    begin(store, "ramen", "Best ramen", 1);
    show(store);
    expect(screen.getByText("1 of 10 placed")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Resume game" })).toBeNull();
  });

  it("has a shorter menu of its own: Open, Resume game, Save my list, and Discard with Undo (artboard 39)", async () => {
    const user = userEvent.setup();
    const store = memoryStore();
    begin(store, "a24", "Every A24 film", 3);
    store.write(
      playKey("list:a24"),
      encodeGame(newGame("hill", ["0", "1", "2"], EVERYTHING, 1, Date.now()), Date.now()),
    );
    const notices: SnackbarNotice[] = [];
    show(store, (notice) => notices.push(notice));
    fireEvent.contextMenu(screen.getByText("Every A24 film"));
    const menu = screen.getByRole("menu", { name: "More for Every A24 film" });
    expect(menu).toHaveTextContent("3 of 10 placed");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.lastChild?.textContent),
    ).toEqual(["Open", "Resume game", "Save my list", "Discard your version"]);
    await user.click(screen.getByRole("menuitem", { name: /Discard your version/ }));
    expect(screen.queryByRole("region", { name: /Continue/ })).toBeNull();
    expect(store.read(draftKey("a24"))).toBeNull();
    expect(store.read(playKey("list:a24"))).toBeNull();
    expect(notices[0]?.text).toBe("Your version discarded");
    await act(async () => notices[0]?.action?.onClick());
    expect(screen.getByRole("region", { name: "Continue · 1" })).toBeInTheDocument();
    expect(store.read(playKey("list:a24"))).not.toBeNull();
  });

  it("opens the list to save it from Save my list, from ⋮", async () => {
    const user = userEvent.setup();
    const store = memoryStore();
    begin(store, "ramen", "Best ramen", 1);
    show(store);
    await user.click(screen.getByRole("button", { name: "More for Best ramen" }));
    await user.click(screen.getByRole("menuitem", { name: /Save my list/ }));
    expect(await screen.findByText("saving")).toBeInTheDocument();
  });

  describe("swiped aside on a touch screen (artboard 45)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("discards past a third of the row, either way, with Undo that brings the game back", () => {
      vi.useFakeTimers();
      for (const to of [260, 40]) {
        const store = memoryStore();
        begin(store, "a24", "Every A24 film", 3);
        store.write(
          playKey("list:a24"),
          encodeGame(newGame("hill", ["0", "1", "2"], EVERYTHING, 1, Date.now()), Date.now()),
        );
        const notices: SnackbarNotice[] = [];
        show(store, (notice) => notices.push(notice));
        const row = rowOf("Every A24 film");
        row.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
        finger("pointerdown", row, 150);
        finger("pointermove", row, to);
        // The bin and its word under the row, at the edge it left.
        const under = row.querySelector(".started__under")!;
        expect(under).toHaveTextContent("Discard");
        expect(under).toHaveClass(to > 150 ? "started__under--left" : "started__under--right");
        finger("pointerup", row, to);
        // Still there while it slides away.
        expect(store.read(draftKey("a24"))).not.toBeNull();
        act(() => vi.advanceTimersByTime(250));
        expect(screen.queryByRole("region", { name: /Continue/ })).toBeNull();
        expect(store.read(draftKey("a24"))).toBeNull();
        expect(store.read(playKey("list:a24"))).toBeNull();
        expect(notices[0]?.text).toBe("Your version discarded");
        expect(notices[0]?.action?.text).toBe("Undo");
        act(() => notices[0]?.action?.onClick());
        expect(screen.getByRole("region", { name: "Continue · 1" })).toBeInTheDocument();
        expect(store.read(playKey("list:a24"))).not.toBeNull();
        expect(rowOf("Every A24 film").querySelector(".started__under")).toBeNull();
        document.body.innerHTML = "";
      }
    });

    it("comes back when let go before a third, and nothing is discarded", () => {
      vi.useFakeTimers();
      const store = memoryStore();
      begin(store, "a24", "Every A24 film", 3);
      const notices: SnackbarNotice[] = [];
      show(store, (notice) => notices.push(notice));
      swipe(rowOf("Every A24 film"), 230);
      act(() => vi.advanceTimersByTime(250));
      expect(rowOf("Every A24 film").querySelector(".started__under")).toBeNull();
      expect(store.read(draftKey("a24"))).not.toBeNull();
      expect(notices).toEqual([]);
    });

    it("leaves a mouse drag, a move up the page and a held finger alone", () => {
      vi.useFakeTimers();
      const store = memoryStore();
      begin(store, "a24", "Every A24 film", 3);
      show(store);
      swipe(rowOf("Every A24 film"), 20, 100, "mouse");
      swipe(rowOf("Every A24 film"), 170, 300);
      // A finger held until the menu opens, moved after.
      const row = rowOf("Every A24 film");
      finger("pointerdown", row, 150);
      act(() => vi.advanceTimersByTime(600));
      finger("pointermove", row, 20);
      finger("pointerup", row, 20);
      act(() => vi.advanceTimersByTime(250));
      expect(store.read(draftKey("a24"))).not.toBeNull();
      expect(screen.getByRole("region", { name: "Continue · 1" })).toBeInTheDocument();
    });
  });
});
