import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { Ranking } from "../api/rank";
import { SessionContext, type Session } from "../app/session";
import { RankingPage, SAVED_NOTE_MS, type Rearrange } from "./RankingPage";

const ranking: Ranking = {
  code: "abcdefgh",
  listId: "wMRMFDxo8UejcAi2VVMW",
  listAvailable: true,
  createdAt: 0,
  rows: [[1], [0]],
  yours: true,
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

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const load = vi.fn<(code: string, asAccount?: boolean) => Promise<Ranking>>();
const rearrange = vi.fn<Rearrange>();

const open = (path = "/r/abcdefgh", account: Session["account"] = member) => {
  const routes: RouteObject[] = [
    { path: "/r/:code", element: <RankingPage load={load} rearrange={rearrange} /> },
  ];
  render(
    <SessionContext.Provider
      value={{ account, signIn: async () => ({ kind: "cancelled" }), signOut: async () => {} }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </SessionContext.Provider>,
  );
};

const tier = (label: string) => screen.getByRole("list", { name: label });

beforeEach(() => {
  load.mockReset();
  rearrange.mockReset();
});

describe("editing a ranking", () => {
  it("asks as the account, offers the owner Edit, saves under the same code and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    load.mockResolvedValue(ranking);
    rearrange.mockResolvedValue({ code: "abcdefgh" });
    open();

    expect(await screen.findByText(/ranked by you/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("abcdefgh", true);
    expect(screen.getByText(/the link stays the same when you edit/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(within(tier("S")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(rearrange).toHaveBeenCalledWith("abcdefgh", [[1, 0], []]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved. Same link, new arrangement.",
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your ranking" })).toHaveTextContent("Ex Machina");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");

    act(() => {
      vi.advanceTimersByTime(SAVED_NOTE_MS + 100);
    });
    expect(screen.queryByRole("status")).toBeNull();
    vi.useRealTimers();
  });

  it("opens straight into editing from the address, and Cancel keeps what was saved", async () => {
    load.mockResolvedValue(ranking);
    open("/r/abcdefgh?edit");
    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ex Machina" }));
    await userEvent.keyboard("1");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(rearrange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
  });

  it("names a failed save and keeps the board open", async () => {
    load.mockResolvedValue(ranking);
    rearrange.mockRejectedValue(new ApiFailure({ kind: "offline" }));
    open("/r/abcdefgh?edit");
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows Edit to nobody else, whatever the address says", async () => {
    load.mockResolvedValue({ ...ranking, yours: false });
    open("/r/abcdefgh?edit");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("by danylo · ranked by a visitor")).toBeInTheDocument();
  });

  it("asks as a guest until an account is here", async () => {
    load.mockResolvedValue({ ...ranking, yours: undefined });
    open("/r/abcdefgh", { kind: "guest", uid: "g1" });
    await screen.findByRole("heading", { level: 1 });
    expect(load).toHaveBeenCalledWith("abcdefgh", false);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
