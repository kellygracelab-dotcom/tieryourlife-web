import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, type ApiError } from "../api/errors";
import type { Ranking } from "../api/rank";
import { writeKept } from "../features/ranking/kept";
import type { Share } from "../features/ranking/shareImage";
import { localStorageStore } from "../lib/storage";
import { setStrings } from "../strings";
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

const share = vi.fn<Share>();
const copy = vi.fn<(text: string) => Promise<void>>();

const open = (code = "abcdefgh") => {
  const routes: RouteObject[] = [
    { path: "/r/:code", element: <RankingPage load={load} share={share} copy={copy} /> },
  ];
  render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/r/${code}`] })} />,
  );
};

beforeEach(() => {
  load.mockReset();
  share.mockReset();
  share.mockResolvedValue(undefined);
  copy.mockReset();
  copy.mockResolvedValue(undefined);
});

describe("RankingPage, a house list's words and its pictures' credits", () => {
  // The language in use is module state; a test that changes it puts English back.
  afterEach(() => setStrings("en", null));

  const house: Ranking = {
    ...ranking,
    snapshot: {
      ...ranking.snapshot,
      editorial: true,
      authorName: "",
      items: ranking.snapshot.items.map((item, index) =>
        index === 0 ? { ...item, credit: "Jane Doe, CC BY 2.0" } : item,
      ),
      translations: {
        ru: {
          "Every A24 film, ranked": "Все фильмы A24",
          Masterpiece: "Шедевр",
          "The Witch": "Ведьма",
          "Ex Machina": "Из машины",
        },
      },
    },
  };

  it("shows a ranking of a house list in the reader's language, as its list page does", async () => {
    setStrings("ru", {});
    load.mockResolvedValue(house);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Все фильмы A24");
    const board = document.querySelector<HTMLElement>(".ranking--read")!;
    expect(board).toHaveTextContent("Шедевр");
    expect(board).toHaveTextContent("Ведьма");
    expect(board).not.toHaveTextContent("The Witch");
    // A word the house has not translated stands as written.
    expect(board).toHaveTextContent("Climax");
  });

  it("stands as kept for a ranking kept before it carried the words", async () => {
    setStrings("ru", {});
    load.mockResolvedValue(ranking);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Every A24 film, ranked",
    );
  });

  it("names the photographers its pictures ask for, as the list page does", async () => {
    load.mockResolvedValue(house);
    open();
    const credits = await screen.findByRole("region", { name: "Picture credits" });
    expect(credits).toHaveTextContent("Ex Machina — Jane Doe, CC BY 2.0");
    cleanup();
    load.mockResolvedValue(ranking);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Picture credits" })).toBeNull();
  });
});

describe("RankingPage", () => {
  it("shows a visitor's ranking with the author's version one chip away", async () => {
    load.mockResolvedValue(ranking);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Every A24 film, ranked",
    );
    expect(document.querySelector(".list-head__meta")).toHaveTextContent(
      /^by danylo · ranked by a visitor$/,
    );
    const board = screen.getByRole("region", { name: "Visitor’s ranking" });
    expect(board).toHaveTextContent("The Witch");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
    expect(load).toHaveBeenCalledWith("abcdefgh", false);

    await userEvent.click(screen.getByRole("button", { name: "Their ranking" }));
    expect(screen.getByRole("region", { name: "Their ranking" })).toHaveTextContent("Climax");
    expect(screen.getByRole("link", { name: "Rank this list" })).toHaveAttribute(
      "href",
      "/l/wMRMFDxo8UejcAi2VVMW",
    );
  });

  it("hands out the link and the picture beside the board", async () => {
    load.mockResolvedValue(ranking);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Disagree? Rank it yourself.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rank this list" })).toHaveAttribute(
      "href",
      "/l/wMRMFDxo8UejcAi2VVMW",
    );

    // The address in the header is the button: one press copies it, nothing to select.
    const chip = screen.getByRole("button", { name: `${window.location.host}/r/abcdefgh` });
    expect(chip).toHaveAttribute("title", "Copy link");
    await userEvent.click(chip);
    expect(copy).toHaveBeenCalledWith(`https://${window.location.host}/r/abcdefgh`);
    expect(screen.getByRole("button", { name: "Link copied" })).toBe(chip);
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();

    share.mockRejectedValueOnce(new Error("no canvas"));
    await userEvent.click(screen.getByRole("button", { name: "Download image" }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wMRMFDxo8UejcAi2VVMW", title: "Every A24 film, ranked" }),
      ranking.rows,
      `${window.location.host}/r/abcdefgh`,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not make the image");
    await userEvent.click(screen.getByRole("button", { name: "Download image" }));
    expect(share).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("spells the link out when the clipboard refuses it", async () => {
    copy.mockRejectedValue(new Error("no clipboard"));
    load.mockResolvedValue(ranking);
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(
      screen.getByRole("button", { name: `${window.location.host}/r/abcdefgh` }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Could not copy the link: https://${window.location.host}/r/abcdefgh`,
    );
  });

  it("leads from the title to the list while the list is up", async () => {
    load.mockResolvedValue(ranking);
    open();
    const title = await screen.findByRole("heading", { level: 1 });
    expect(within(title).getByRole("link", { name: "Every A24 film, ranked" })).toHaveAttribute(
      "href",
      "/l/wMRMFDxo8UejcAi2VVMW",
    );

    cleanup();
    load.mockResolvedValue({ ...ranking, listAvailable: false });
    open("zzzzzzzz");
    expect(await screen.findByText(/The list this ranking was made from/)).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { level: 1 })).queryByRole("link")).toBeNull();
  });

  it("calls the ranking yours on the device that made it", async () => {
    writeKept(localStorageStore, ranking.listId, { code: "abcdefgh", claimToken: "t" });
    load.mockResolvedValue(ranking);
    open();
    await screen.findByText(/ranked by you/);
    expect(document.querySelector(".list-head__meta")).toHaveTextContent(
      /^by danylo · ranked by you$/,
    );
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();

    // Whoever made the ranking has ranked it: the invitation is for a visitor.
    expect(screen.queryByText("Disagree? Rank it yourself.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Rank this list" })).toBeNull();

    // One's own ranking gets the phone app's words, the same as on the list's page.
    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Their ranking" }));
    expect(screen.getByRole("region", { name: "Their ranking" })).toHaveTextContent("Climax");
  });

  it("names nobody when the list stands without an author", async () => {
    const items = ranking.snapshot.items.map((item) => ({ ...item, tierIndex: null }));
    load.mockResolvedValue({
      ...ranking,
      snapshot: { ...ranking.snapshot, items, editorial: true, authorName: "" },
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector(".list-head__meta")).toHaveTextContent(/^ranked by a visitor$/);
    // A template was never arranged by anybody, and the page does not say so of nobody.
    expect(screen.queryByText(/hasn’t arranged this list/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Their ranking" })).toBeNull();
  });

  it("has no author's version when the snapshot never carried one", async () => {
    const items = ranking.snapshot.items.map((item) => ({ ...item, tierIndex: null }));
    load.mockResolvedValue({ ...ranking, snapshot: { ...ranking.snapshot, items } });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Their ranking" })).toBeNull();
    expect(screen.getByText("danylo hasn’t arranged this list.")).toBeInTheDocument();
  });

  it("says when the list behind the ranking is gone", async () => {
    load.mockResolvedValue({ ...ranking, listAvailable: false });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: "Rank this list" })).toBeNull();
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
