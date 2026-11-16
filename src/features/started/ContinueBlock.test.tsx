import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { boardsRepository } from "../boards/repository";
import { EVERYTHING } from "../play/chosen";
import { newGame } from "../play/game";
import { encodeGame, playKey } from "../play/savedGames";
import { draftKey } from "../tierboard/draft";
import { ContinueBlock } from "./ContinueBlock";
import { wantsResume } from "./started";

function begin(store: KeyValueStore, id: string, title: string, placed: number) {
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
    }),
  );
}

function ListStub() {
  const location = useLocation();
  return <p>{wantsResume(location.state) ? "resuming" : "opened"}</p>;
}

function show(store: KeyValueStore) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <ContinueBlock store={store} repository={boardsRepository(memoryStore())} />,
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
    expect(screen.queryByRole("region", { name: "Continue" })).toBeNull();
  });

  it("leads back into a begun list, and straight into its saved game", async () => {
    const store = memoryStore();
    begin(store, "a24", "Every A24 film", 3);
    store.write(
      playKey("list:a24"),
      encodeGame(newGame("hill", ["0", "1", "2"], EVERYTHING, 1, Date.now()), Date.now()),
    );
    show(store);
    const block = within(screen.getByRole("region", { name: "Continue" }));
    expect(block.getByText("Every A24 film")).toBeInTheDocument();
    expect(block.getByText("3 of 10 placed")).toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: "Resume game" })).toBeNull();
  });
});
