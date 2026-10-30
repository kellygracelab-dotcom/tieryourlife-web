import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminList, AdminListsQuery, ProposedSection } from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import type { SectionStats, Topic } from "../../api/sections";
import { ListsPane, type ListsDeps } from "./ListsPane";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  status: "approved",
  ...more,
});

const topic = (id: string, name: string, more: Partial<Topic> = {}): Topic => ({
  id,
  name,
  section: "games",
  status: "approved",
  listCount: 3,
  followerCount: 0,
  following: false,
  mergedInto: null,
  ...more,
});

const list = (id: string, title: string, more: Partial<AdminList> = {}): AdminList => ({
  id,
  title,
  authorUid: "u1",
  authorName: "mariia",
  authorPhotoUrl: null,
  category: "games",
  itemCount: 10,
  coverImageUrl: null,
  previewImages: [],
  tierColors: ["#ff7f7f", "#ffbf7f"],
  updatedAt: Date.UTC(2026, 8, 2, 12),
  takeCount: 12,
  topicId: null,
  topicName: null,
  underReview: false,
  publishedBy: { uid: "u1", name: "mariia" },
  ...more,
});

const pokemon = topic("t1", "Pokémon");

const PAGES: Record<string, { lists: AdminList[]; nextCursor: string | null }> = {
  "games/t1/": {
    lists: [
      list("a", "Alpha", {
        anonymous: true,
        authorName: "",
        topicId: "t1",
        topicName: "Pokémon",
        publishedBy: { uid: "u0", name: "danylo" },
        coverImageUrl: "https://covers.test/a.webp",
      }),
      list("b", "Bravo", { underReview: true, topicId: "t1", topicName: "Pokémon" }),
    ],
    nextCursor: "b",
  },
  "games/t1/b": {
    lists: [list("c", "Charlie", { topicId: "t1", topicName: "Pokémon" })],
    nextCursor: null,
  },
  "games/none/": { lists: [list("d", "Delta")], nextCursor: null },
  "food/none/": {
    lists: [
      list("e", "Echo", {
        category: "food",
        proposedSection: "street-food",
        proposedSectionName: "Street food",
      }),
      list("f", "Foxtrot", { category: "food", publishedBy: { uid: "u5", name: "olehv" } }),
    ],
    nextCursor: null,
  },
};

const proposal: ProposedSection = {
  ...stats("street-food", { name: "Street food", status: "pending" }),
  fileUnder: "food",
  waitingLists: 2,
};

let deps: ListsDeps;

beforeEach(() => {
  window.innerWidth = 1280;
  deps = {
    sections: vi.fn(async () => ({
      sections: [
        stats("other", { listCount: 1 }),
        stats("food", { listCount: 2 }),
        stats("games", { listCount: 5 }),
        stats("mine", { name: "Mine", status: "pending" }),
      ],
      role: "owner" as const,
    })),
    topics: vi.fn(async (section: string) => ({ topics: section === "games" ? [pokemon] : [] })),
    lists: vi.fn(async (query: AdminListsQuery) => {
      const page = PAGES[`${query.section}/${query.topic ?? ""}/${query.after ?? ""}`];
      return page ?? { lists: [], nextCursor: null };
    }),
    move: vi.fn(async () => undefined),
    proposals: vi.fn(async () => ({ sections: [proposal] })),
  };
});

afterEach(() => {
  window.innerWidth = 1024;
});

const sectionHead = (name: RegExp) => screen.getByRole("button", { name });

async function openGames() {
  await userEvent.click(await screen.findByRole("button", { name: /^Games/ }));
  return within(await screen.findByRole("region", { name: "Pokémon · 3" }));
}

describe("ListsPane", () => {
  it("lists the sections in the admin order with their counts, Other last, and opens one", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    await screen.findByRole("button", { name: /^Games/ });
    const heads = screen
      .getAllByRole("button", { expanded: false })
      .map((head) => head.textContent ?? "");
    expect(heads).toEqual([
      "Games5 listsexpand_more",
      "Food2 listsexpand_more",
      "Other1 listexpand_more",
    ]);
    expect(deps.lists).not.toHaveBeenCalled();

    const group = await openGames();
    expect(sectionHead(/^Games/)).toHaveAttribute("aria-expanded", "true");
    expect(deps.lists).toHaveBeenCalledWith({
      section: "games",
      topic: "t1",
      sort: "recent",
      after: null,
    });
    expect(await screen.findByRole("region", { name: "No topic · 2" })).toBeInTheDocument();
    const alpha = (await group.findByText("Alpha")).closest("li")!;
    expect(alpha).toHaveTextContent("12 rankings · Anonymous (danylo) · Sep 2");
    expect(alpha.querySelector("img")).toHaveAttribute("src", "https://covers.test/a.webp");
    expect(within(alpha).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/l/a");
    expect(within(alpha).getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
    const bravo = group.getByText("Bravo").closest("li")!;
    expect(within(bravo).getByText("Under review")).toBeInTheDocument();
    expect(within(alpha).queryByText("Under review")).toBeNull();

    await userEvent.click(sectionHead(/^Games/));
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("names an anonymous list's author to the owner only", async () => {
    render(<ListsPane adminRole="moderator" deps={deps} />);
    const group = await openGames();
    expect((await group.findByText("Alpha")).closest("li")).toHaveTextContent(
      "12 rankings · Anonymous · Sep 2",
    );
    expect(screen.queryByText(/danylo/)).toBeNull();
    // Nor does a search by the author's name give them away.
    await userEvent.type(screen.getByRole("searchbox"), "danylo");
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("shows twenty more from where the page ended", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    const group = await openGames();
    await group.findByText("Bravo");
    await userEvent.click(group.getByRole("button", { name: "Show 20 more" }));
    expect(await group.findByText("Charlie")).toBeInTheDocument();
    expect(deps.lists).toHaveBeenCalledWith({
      section: "games",
      topic: "t1",
      sort: "recent",
      after: "b",
    });
    expect(group.queryByRole("button", { name: "Show 20 more" })).toBeNull();
  });

  it("starts a group again when the list its page ended at went", async () => {
    deps.lists = vi.fn(async (query: AdminListsQuery) => {
      if (query.after === "b") throw new ApiFailure({ kind: "cursorGone" });
      return PAGES[`${query.section}/${query.topic ?? ""}/`] ?? { lists: [], nextCursor: null };
    });
    render(<ListsPane adminRole="owner" deps={deps} />);
    const group = await openGames();
    await group.findByText("Bravo");
    await userEvent.click(group.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(deps.lists)
          .mock.calls.filter(([query]) => query.topic === "t1" && query.after === null),
      ).toHaveLength(2),
    );
  });

  it("says a page that did not come", async () => {
    deps.lists = vi.fn(async (query: AdminListsQuery) => {
      if (query.after === "b") throw new ApiFailure({ kind: "offline" });
      return PAGES[`${query.section}/${query.topic ?? ""}/`] ?? { lists: [], nextCursor: null };
    });
    render(<ListsPane adminRole="owner" deps={deps} />);
    const group = await openGames();
    await group.findByText("Bravo");
    await userEvent.click(group.getByRole("button", { name: "Show 20 more" }));
    expect(await group.findByRole("alert")).toHaveTextContent("That didn’t go through.");
  });

  it("moves a list into another section in a dialog, slides it out, and undoes it", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    const group = await openGames();
    const alpha = (await group.findByText("Alpha")).closest("li")!;
    await userEvent.click(within(alpha).getByRole("button", { name: "Move" }));
    const dialog = within(screen.getByRole("dialog", { name: "Move “Alpha”" }));
    const section = dialog.getByRole("combobox", { name: "Section" });
    const where = dialog.getByRole("combobox", { name: "Topic" });
    expect(section).toHaveValue("games");
    await waitFor(() => expect(where).toHaveValue("t1"));
    // Where it is already is nowhere to move to.
    expect(dialog.getByRole("button", { name: "Move" })).toBeDisabled();
    await userEvent.selectOptions(section, "food");
    expect(where).toHaveValue("");
    await userEvent.click(dialog.getByRole("button", { name: "Move" }));
    expect(deps.move).toHaveBeenCalledWith("a", { category: "food", topicId: null });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Moved to Food");
    expect(alpha).toHaveClass("admin-list--leaving");
    await waitFor(() => expect(group.queryByText("Alpha")).toBeNull());
    expect(sectionHead(/^Games/)).toHaveTextContent("4 lists");
    expect(screen.getByRole("region", { name: "Pokémon · 2" })).toBeInTheDocument();
    expect(sectionHead(/^Food/)).toHaveTextContent("3 lists");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(deps.move).toHaveBeenLastCalledWith("a", { topicId: "t1" });
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Moved back to Games · Pokémon");
    expect(sectionHead(/^Games/)).toHaveTextContent("5 lists");
  });

  it("moves a list into a topic of its section", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    await openGames();
    const delta = (await screen.findByText("Delta")).closest("li")!;
    await userEvent.click(within(delta).getByRole("button", { name: "Move" }));
    const dialog = within(screen.getByRole("dialog", { name: "Move “Delta”" }));
    await userEvent.selectOptions(
      await dialog.findByRole("combobox", { name: "Topic" }),
      await dialog.findByRole("option", { name: "Pokémon" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Move" }));
    expect(deps.move).toHaveBeenCalledWith("d", { topicId: "t1" });
    expect(screen.getByRole("status")).toHaveTextContent("Moved to Games · Pokémon");
    expect(screen.getByRole("region", { name: "Pokémon · 4" })).toBeInTheDocument();
  });

  it("asks again before moving a list that waits for a proposed section", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Food/ }));
    const echo = (await screen.findByText("Echo")).closest("li")!;
    expect(within(echo).getByText("Waits for Street food")).toBeInTheDocument();
    await userEvent.click(within(echo).getByRole("button", { name: "Move" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("note")).toHaveTextContent(
      "This list waits for the proposed section Street food. Moving it takes it out of that proposal.",
    );
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Section" }), "games");
    await userEvent.click(dialog.getByRole("button", { name: "Move anyway" }));
    expect(deps.move).toHaveBeenCalledWith("e", { category: "games", topicId: null });
  });

  it("warns that a list without a topic may wait, where the backend does not say", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Food/ }));
    const foxtrot = (await screen.findByText("Foxtrot")).closest("li")!;
    await userEvent.click(within(foxtrot).getByRole("button", { name: "Move" }));
    expect(screen.getByRole("note")).toHaveTextContent(
      "Lists here may wait for a proposed section (Street food).",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.move).not.toHaveBeenCalled();
  });

  it("says a move that did not go through in its dialog", async () => {
    deps.move = vi.fn(async () => {
      throw new ApiFailure({ kind: "offline" });
    });
    render(<ListsPane adminRole="owner" deps={deps} />);
    await openGames();
    const delta = (await screen.findByText("Delta")).closest("li")!;
    await userEvent.click(within(delta).getByRole("button", { name: "Move" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Section" }), "food");
    await userEvent.click(dialog.getByRole("button", { name: "Move" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("That didn’t go through.");
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("narrows what the open sections read by title or author", async () => {
    render(<ListsPane adminRole="owner" deps={deps} />);
    await openGames();
    await screen.findByText("Delta");
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search lists by title or author" }),
      "danylo",
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).toBeNull();
    expect(screen.queryByRole("region", { name: "No topic · 2" })).toBeNull();
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "delta");
    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("folds a row's actions into a menu below 840", async () => {
    window.innerWidth = 600;
    render(<ListsPane adminRole="owner" deps={deps} />);
    await openGames();
    const alpha = (await screen.findByText("Alpha")).closest("li")!;
    expect(alpha.querySelector(".admin-list__actions")).toBeNull();
    await userEvent.click(within(alpha).getByLabelText("More for Alpha"));
    expect(within(alpha).getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
    await userEvent.click(within(alpha).getByRole("button", { name: "Move" }));
    expect(screen.getByRole("dialog", { name: "Move “Alpha”" })).toHaveClass("move-dialog--sheet");
  });

  it("offers another try when the sections did not come", async () => {
    deps.sections = vi
      .fn<ListsDeps["sections"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce({ sections: [stats("games", { listCount: 5 })] });
    render(<ListsPane adminRole="owner" deps={deps} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^Games/ })).toBeInTheDocument();
  });

  it("says a section's topics that did not come, and an empty group", async () => {
    deps.topics = vi
      .fn<ListsDeps["topics"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValue({ topics: [] });
    render(<ListsPane adminRole="owner" deps={deps} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Other/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No lists here.")).toBeInTheDocument();
  });
});
