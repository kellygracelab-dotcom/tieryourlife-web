import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
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
    expect(block.getByText("Film & TV · 3 of 10 placed")).toBeInTheDocument();
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
    ).toEqual(["Open", "Resume game", "Save my list", "Discard my arrangement"]);
    await user.click(screen.getByRole("menuitem", { name: /Discard my arrangement/ }));
    expect(screen.queryByRole("region", { name: /Continue/ })).toBeNull();
    expect(store.read(draftKey("a24"))).toBeNull();
    expect(store.read(playKey("list:a24"))).toBeNull();
    expect(notices[0]?.text).toBe("Arrangement discarded");
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
});
