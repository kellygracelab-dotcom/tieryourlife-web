import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSections } from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import { SectionsPane, type SectionsPaneDeps } from "./SectionsPane";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 10,
  followerCount: 2,
  newThisWeek: 0,
  collage: [],
  following: false,
  status: "approved",
  ...more,
});

const answer: AdminSections = {
  sections: [
    stats("anime"),
    stats("games"),
    stats("food", { hidden: true }),
    stats("street-food", { name: "Street food", status: "pending" }),
    stats("other"),
  ],
  role: "owner",
  version: 7,
};

const deps = {
  load: vi.fn<SectionsPaneDeps["load"]>(),
  save: vi.fn<SectionsPaneDeps["save"]>(),
};

function open(role: "owner" | "moderator" = "owner") {
  const router = createMemoryRouter(
    [
      { path: "/admin/sections", element: <SectionsPane adminRole={role} deps={deps} /> },
      { path: "/elsewhere", element: <h1>Elsewhere</h1> },
    ],
    { initialEntries: ["/admin/sections"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const rowNames = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".admin-order__name")?.textContent);

beforeEach(() => {
  deps.load.mockReset();
  deps.load.mockResolvedValue(answer);
  deps.save.mockReset();
  deps.save.mockResolvedValue({ version: 8 });
});

describe("SectionsPane", () => {
  it("lists the approved sections in order, Other last and locked, the hidden ones marked", async () => {
    open();
    expect(await screen.findByText("4 sections · 1 hidden")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Anime", "Games", "Food", "Other"]);
    expect(screen.getByText(/Hidden — not on the home page/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Other" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Show Other" })).toBeNull();
  });

  it("moves a row with Alt and the arrows, and saves the whole order with its version", async () => {
    open();
    await screen.findByText("4 sections · 1 hidden");
    screen.getByRole("button", { name: "Move Games" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(rowNames()).toEqual(["Games", "Anime", "Food", "Other"]);
    expect(screen.getByText("Games, moved to position 1 of 4")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent(
      "Unsaved changes · order",
    );

    await userEvent.click(screen.getByRole("switch", { name: "Show Food" }));
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent(
      "order and 1 section shown or hidden",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(deps.save).toHaveBeenCalledWith(["games", "anime", "food", "other"], [], 7);
    expect(
      await screen.findByText("Order saved. The site and the app show it now."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  });

  it("picks a row up with Space, carries it with the arrows, and puts it back with Escape", async () => {
    open();
    await screen.findByText("4 sections · 1 hidden");
    screen.getByRole("button", { name: "Move Anime" }).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowDown}");
    expect(rowNames()).toEqual(["Games", "Anime", "Food", "Other"]);
    screen.getByRole("button", { name: "Move Anime" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(rowNames()).toEqual(["Anime", "Games", "Food", "Other"]);
  });

  it("refuses to overwrite somebody else's Save, and offers to reload", async () => {
    deps.save.mockRejectedValueOnce(new ApiFailure({ kind: "conflict" }));
    open();
    await screen.findByText("4 sections · 1 hidden");
    screen.getByRole("button", { name: "Move Games" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed the order.");
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(deps.load).toHaveBeenCalledTimes(2);
  });

  it("asks before leaving with changes, and stays on request", async () => {
    const router = open();
    await screen.findByText("4 sections · 1 hidden");
    screen.getByRole("button", { name: "Move Games" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    void router.navigate("/elsewhere");
    expect(
      await screen.findByRole("alertdialog", { name: "Leave without saving?" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(router.state.location.pathname).toBe("/admin/sections");
  });

  it("shows a moderator the order without the means to change it", async () => {
    open("moderator");
    await screen.findByText("4 sections · 1 hidden");
    expect(
      screen.getByText("Only the owner changes the order and what is shown."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move/ })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
