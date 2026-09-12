import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, type ApiError } from "../api/errors";
import type { Ranking } from "../api/rank";
import { writeKept } from "../features/ranking/kept";
import { localStorageStore } from "../features/board/draft";
import { RankingPage } from "./RankingPage";

const ranking: Ranking = {
  code: "abcdefgh",
  listId: "wMRMFDxo8UejcAi2VVMW",
  listAvailable: true,
  createdAt: 0,
  rows: [[1], [0]],
  snapshot: {
    title: "Every A24 film, ranked",
    authorName: "danylo",
    authorPhotoUrl: null,
    category: "film_tv",
    tiers: [
      { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
      { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
    ],
    items: [
      { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
      { title: "The Witch", imageUrl: null, tierIndex: null },
      { title: "Climax", imageUrl: null, tierIndex: 1 },
    ],
  },
};

const load = vi.fn<(code: string) => Promise<Ranking>>();

const open = (code = "abcdefgh") => {
  const routes: RouteObject[] = [{ path: "/r/:code", element: <RankingPage load={load} /> }];
  render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/r/${code}`] })} />,
  );
};

beforeEach(() => {
  load.mockReset();
});

describe("RankingPage", () => {
  it("shows a visitor's ranking with the author's version one chip away", async () => {
    load.mockResolvedValue(ranking);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Every A24 film, ranked",
    );
    expect(screen.getByText("by danylo · ranked by a visitor")).toBeInTheDocument();
    const board = screen.getByRole("region", { name: "Visitor's ranking" });
    expect(board).toHaveTextContent("The Witch");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
    expect(load).toHaveBeenCalledWith("abcdefgh");

    await userEvent.click(screen.getByRole("button", { name: "Author's version" }));
    expect(screen.getByRole("region", { name: "Author's version" })).toHaveTextContent("Climax");
    expect(screen.getByRole("link", { name: "Disagree? Rank it yourself." })).toHaveAttribute(
      "href",
      "/l/wMRMFDxo8UejcAi2VVMW",
    );
  });

  it("calls the ranking yours on the device that made it", async () => {
    writeKept(localStorageStore, ranking.listId, { code: "abcdefgh", claimToken: "t" });
    load.mockResolvedValue(ranking);
    open();
    expect(await screen.findByText("by danylo · ranked by you")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
  });

  it("has no author's version when the snapshot never carried one", async () => {
    const items = ranking.snapshot.items.map((item) => ({ ...item, tierIndex: null }));
    load.mockResolvedValue({ ...ranking, snapshot: { ...ranking.snapshot, items } });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Author's version" })).toBeNull();
    expect(screen.getByText("danylo hasn’t arranged this list.")).toBeInTheDocument();
  });

  it("says when the list behind the ranking is gone", async () => {
    load.mockResolvedValue({ ...ranking, listAvailable: false });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: "Disagree? Rank it yourself." })).toBeNull();
    expect(screen.getByText(/The list this ranking was made from/)).toBeInTheDocument();
  });

  it.each<ApiError>([{ kind: "notFound" }])(
    "says a ranking is not available on %o",
    async (error) => {
      load.mockRejectedValue(new ApiFailure(error));
      open();
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "This ranking isn’t available",
      );
      expect(screen.getByRole("link", { name: "Go to the front page" })).toBeInTheDocument();
    },
  );

  it("explains an unverified copy and retries after a dropped connection", async () => {
    load.mockRejectedValueOnce(new ApiFailure({ kind: "appUnverified" }));
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "This copy of the site could not be verified",
    );

    load.mockRejectedValueOnce(new ApiFailure({ kind: "offline" })).mockResolvedValueOnce(ranking);
    open("zzzzzzzz");
    expect(await screen.findByText("No connection")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Every A24 film, ranked")).toBeInTheDocument();
  });

  it("names any other failure", async () => {
    load.mockRejectedValue(new ApiFailure({ kind: "unknown", status: 500 }));
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Could not open this ranking",
    );
  });
});
