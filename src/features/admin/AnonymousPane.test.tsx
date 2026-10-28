import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { AnonymousList } from "../../api/admin";
import { memoryStore } from "../../lib/storage";
import { newBoard } from "../boards/model";
import { boardsRepository } from "../boards/repository";
import { AnonymousPane, type AnonymousDeps } from "./AnonymousPane";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const anonymous = (id: string, title: string): AnonymousList => ({
  id,
  title,
  anonymous: true,
  authorUid: "",
  authorName: "",
  authorPhotoUrl: null,
  category: "food",
  itemCount: 5,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 402,
  publishedBy: { uid: "owner", name: "Danylo" },
});

function open(deps: AnonymousDeps) {
  const router = createMemoryRouter(
    [
      { path: "/admin/anonymous", element: <AnonymousPane deps={deps} /> },
      { path: "/b/:uid", element: <h1>Board page</h1> },
    ],
    { initialEntries: ["/admin/anonymous"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("AnonymousPane", () => {
  it("lists what was published with no author, with who it came from, a page at a time", async () => {
    const load = vi.fn(async (after: string | null) =>
      after === null
        ? { lists: [anonymous("l1", "Street food in Kyiv")], nextCursor: "c1" }
        : { lists: [anonymous("l2", "Comfort rewatches")], nextCursor: null },
    );
    open({ load, repository: boardsRepository(memoryStore()), now: () => 1 });
    expect(await screen.findByText("Street food in Kyiv")).toBeInTheDocument();
    expect(screen.getByText("Food · 402 rankings · by Danylo")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Comfort rewatches")).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith("c1");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("publishes one of the owner's lists by marking it anonymous and opening its settings", async () => {
    const repository = boardsRepository(memoryStore());
    repository.save(newBoard("b1", "Sci-fi films", 1, () => `x${Math.random()}`));
    const router = open({
      load: vi.fn(async () => ({ lists: [], nextCursor: null })),
      repository,
      now: () => 2,
    });
    expect(await screen.findByText("Nothing published anonymously yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish a list" }));
    expect(
      screen.getByText("It shows “Anonymous” as the author. Only admins can see it came from you."),
    ).toBeInTheDocument();
    const [, pick] = screen.getAllByRole("button", { name: "Publish a list" });
    await userEvent.click(pick!);
    expect(repository.get("b1")?.anonymous).toBe(true);
    expect(router.state.location.pathname).toBe("/b/b1");
    expect(router.state.location.search).toBe("?settings=1");
  });
});
