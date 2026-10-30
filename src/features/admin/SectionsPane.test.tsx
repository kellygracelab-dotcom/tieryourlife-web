import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSections } from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import { memoryStore } from "../../lib/storage";
import type { EditorDeps } from "../sections/editorDeps";
import type { SectionWrites } from "./sectionWrites";
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

const writes = {
  create: vi.fn<SectionWrites["create"]>(),
  edit: vi.fn<SectionWrites["edit"]>(),
};

/** The section form without the network, canvas or storage. */
const editor: EditorDeps = {
  check: async () => ({ free: true }),
  upload: async () => ({ pictureId: "p", previewUrl: "https://p" }),
  crop: async () => new Blob(["webp"], { type: "image/webp" }),
  keep: memoryStore(),
};

function open(role: "owner" | "moderator" = "owner") {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/sections",
        element: <SectionsPane adminRole={role} deps={deps} writes={writes} editor={editor} />,
      },
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
  writes.create.mockReset();
  writes.create.mockImplementation(async (draft) =>
    stats("street-food", { name: draft.name, icon: draft.icon }),
  );
  writes.edit.mockReset();
  writes.edit.mockImplementation(async (id, changes) => stats(id, { name: changes.name }));
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

  it("draws a section's own picture in its thumbnail, under the tile's scrim", async () => {
    deps.load.mockResolvedValue({
      ...answer,
      sections: [
        stats("ramen", { name: "Ramen", pictureUrl: "https://pictures.test/ramen.webp" }),
        stats("other"),
      ],
    });
    open();
    const row = (await screen.findByText("Ramen")).closest("li")!;
    const thumb = row.querySelector(".admin-order__thumb")!;
    expect(thumb).toHaveClass("admin-order__thumb--pictured");
    expect((thumb as HTMLElement).style.getPropertyValue("--section-picture")).toContain(
      "https://pictures.test/ramen.webp",
    );
    const other = screen.getByText("Other").closest("li")!;
    expect(other.querySelector(".admin-order__thumb")).not.toHaveClass(
      "admin-order__thumb--pictured",
    );
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
    expect(screen.queryByRole("button", { name: "New section" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  });

  describe("New section and Edit", () => {
    const withStreetFood: AdminSections = {
      ...answer,
      sections: [
        ...answer.sections.filter((one) => one.id !== "other"),
        stats("street-food", { name: "Street food", status: "approved" }),
        stats("other"),
      ],
      version: 8,
    };

    it("makes a new section with the proposal's form, and reads the order back with it before Other", async () => {
      open();
      await screen.findByText("4 sections · 1 hidden");
      deps.load.mockResolvedValue(withStreetFood);
      await userEvent.click(screen.getByRole("button", { name: "New section" }));
      const form = screen.getByRole("dialog", { name: "New section" });
      expect(within(form).queryByRole("combobox")).toBeNull();
      expect(within(form).getByRole("group", { name: "Translations" })).toBeInTheDocument();
      await userEvent.type(within(form).getByRole("textbox", { name: "Name" }), "Street food");
      await userEvent.click(within(form).getByRole("button", { name: "Create" }));
      expect(writes.create).toHaveBeenCalledWith({ name: "Street food", icon: "category" });
      expect(await screen.findByText("Street food created")).toBeInTheDocument();
      expect(rowNames()).toEqual(["Anime", "Games", "Food", "Street food", "Other"]);
      expect(deps.load).toHaveBeenCalledTimes(2);
      // No Save is needed for it.
      expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
    });

    it("keeps an order not yet saved over the reload a new section brings", async () => {
      open();
      await screen.findByText("4 sections · 1 hidden");
      screen.getByRole("button", { name: "Move Games" }).focus();
      await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
      deps.load.mockResolvedValue(withStreetFood);
      await userEvent.click(screen.getByRole("button", { name: "New section" }));
      await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Street food");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      await screen.findByText("Street food created");
      expect(rowNames()).toEqual(["Games", "Anime", "Food", "Street food", "Other"]);
      expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("order");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(deps.save).toHaveBeenLastCalledWith(
        ["games", "anime", "food", "street-food", "other"],
        ["food"],
        8,
      );
    });

    it("edits a row in a side sheet, sends only what changed, and shows it at once", async () => {
      open();
      await screen.findByText("4 sections · 1 hidden");
      await userEvent.click(screen.getByRole("button", { name: "Edit Games" }));
      const sheet = screen.getByRole("dialog", { name: "Edit section" });
      // A built-in keeps its art: no picture to change.
      expect(within(sheet).queryByRole("button", { name: "Replace" })).toBeNull();
      const name = within(sheet).getByRole("textbox", { name: "Name" });
      await userEvent.clear(name);
      await userEvent.type(name, "Video games");
      await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
      expect(writes.edit).toHaveBeenCalledWith("games", { name: "Video games" });
      expect(await screen.findByText("Video games saved")).toBeInTheDocument();
      expect(rowNames()).toEqual(["Anime", "Video games", "Food", "Other"]);
      expect(deps.load).toHaveBeenCalledTimes(1);
    });

    it("closes the sheet with nothing changed", async () => {
      open();
      await screen.findByText("4 sections · 1 hidden");
      await userEvent.click(screen.getByRole("button", { name: "Edit Other" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "New section" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
