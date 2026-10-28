import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Moderator, PendingTopic, ProposedSection } from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import type { Topic } from "../../api/sections";
import { memoryStore } from "../../lib/storage";
import type { EditorDeps } from "../sections/editorDeps";
import { ModeratorsPane, type ModeratorsDeps } from "./ModeratorsPane";
import { ProposalsPane, type ProposalsDeps } from "./ProposalsPane";
import type { SectionWrites } from "./sectionWrites";
import { TopicsPane, type TopicsDeps } from "./TopicsPane";

/** The section form without the network, canvas or storage. */
const editorFakes = (): EditorDeps => ({
  check: vi.fn(async () => ({ free: true })),
  upload: vi.fn(async () => ({ pictureId: "p", previewUrl: "https://p" })),
  crop: vi.fn(async () => new Blob(["webp"], { type: "image/webp" })),
  keep: memoryStore(),
});

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const topic = (id: string, name: string, more: Partial<Topic> = {}): Topic => ({
  id,
  name,
  section: "games",
  status: "approved",
  listCount: 3,
  followerCount: 5,
  following: false,
  createdBy: "u9",
  mergedInto: null,
  ...more,
});

const proposed: ProposedSection = {
  id: "street-food",
  name: "Street food",
  icon: "restaurant",
  status: "pending",
  fileUnder: "food",
  proposerName: "mariia",
  waitingLists: 6,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  tint: { light: "#7A4A33", dark: "#3A2A26" },
};

const pendingTopic: PendingTopic = {
  ...topic("t9", "Speedruns", { status: "pending" }),
  proposerName: "olehv",
  requestedSection: "games",
  similar: [topic("t1", "Speedrunning")],
};

const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe("ProposalsPane", () => {
  let deps: ProposalsDeps;
  beforeEach(() => {
    deps = {
      sections: vi.fn(async () => ({ sections: [proposed] })),
      topics: vi.fn(async () => ({ topics: [pendingTopic] })),
      approveSection: vi.fn(async () => undefined),
      declineSection: vi.fn(async () => undefined),
      mergeSection: vi.fn(async () => undefined),
      decideTopic: vi.fn(async () => undefined),
    };
  });

  it("shows each proposal with what it would look like and the lists waiting for it", async () => {
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    expect(await screen.findByText("2 waiting")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Street food" })).toBeInTheDocument();
    expect(screen.getByText("6 lists filed under Food until approval")).toBeInTheDocument();
    expect(screen.getByText("Topic in Games · proposed by olehv")).toBeInTheDocument();
    expect(screen.getByText("Looks like: Speedrunning")).toBeInTheDocument();
  });

  it("approves at once, and declines with a note to the proposer", async () => {
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Decline" }));
    await userEvent.type(
      within(card).getByLabelText("Note to mariia (optional)"),
      "Too close to Food",
    );
    await userEvent.click(within(card).getByRole("button", { name: "Decline" }));
    expect(deps.declineSection).toHaveBeenCalledWith("street-food", "Too close to Food");
    expect(await screen.findByText("Street food declined")).toBeInTheDocument();

    const topicCard = screen.getByRole("heading", { name: "Speedruns" }).closest("li")!;
    await userEvent.click(within(topicCard).getByRole("button", { name: "Approve" }));
    expect(deps.decideTopic).toHaveBeenCalledWith("t9", { action: "approve", section: "games" });
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("merges a topic into its twin, and offers a section's merge to the owner alone", async () => {
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    await screen.findByRole("heading", { name: "Street food" });
    expect(screen.queryByRole("button", { name: "Merge into…" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Merge into Speedrunning" }));
    expect(deps.decideTopic).toHaveBeenCalledWith("t9", { action: "merge", into: "t1" });
  });

  it("lets the owner edit a proposal in a side sheet, and keeps its card in the queue", async () => {
    const writes = {
      create: vi.fn<SectionWrites["create"]>(),
      edit: vi.fn<SectionWrites["edit"]>(async (id, changes) => ({
        ...proposed,
        id,
        name: changes.name ?? proposed.name,
      })),
    };
    wrap(<ProposalsPane adminRole="owner" deps={deps} writes={writes} editor={editorFakes()} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit section" });
    expect(sheet).toHaveClass("section-editor--side");
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Street food");
    await userEvent.clear(name);
    await userEvent.type(name, "Street eats");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(writes.edit).toHaveBeenCalledWith("street-food", { name: "Street eats" });
    expect(await screen.findByText("Street eats saved")).toBeInTheDocument();
    const edited = screen.getByRole("heading", { name: "Street eats" }).closest("li")!;
    expect(within(edited).getByText("6 lists filed under Food until approval")).toBeInTheDocument();
    expect(within(edited).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Edit from a moderator", async () => {
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    expect(within(card).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("says when somebody else decided first, and reads the queue again", async () => {
    deps.approveSection = vi.fn(async () => {
      throw new ApiFailure({ kind: "conflict" });
    });
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Someone else already decided this one.")).toBeInTheDocument();
    expect(deps.sections).toHaveBeenCalledTimes(2);
  });

  it("says a decision that did not go through on the card itself", async () => {
    deps.approveSection = vi.fn(async () => {
      throw new ApiFailure({ kind: "offline" });
    });
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("That didn’t go through.");
  });

  it("finds nothing waiting on a backend without section proposals yet", async () => {
    deps.sections = vi.fn(async () => Promise.reject(new ApiFailure({ kind: "notFound" })));
    deps.topics = vi.fn(async () => ({ topics: [] }));
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });
});

describe("TopicsPane", () => {
  let deps: TopicsDeps;
  beforeEach(() => {
    deps = {
      load: vi.fn(async () => ({
        topics: [
          topic("t1", "Indies", { followerCount: 2 }),
          topic("t2", "Pokémon", { listCount: 0 }),
        ],
      })),
      create: vi.fn(async (draft) => topic("t3", draft.name)),
      rename: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
  });

  it("lists a section's topics, most followed first, and creates one directly", async () => {
    wrap(<TopicsPane adminRole="owner" deps={deps} />);
    expect(await screen.findByText("Pokémon")).toBeInTheDocument();
    const names = [...document.querySelectorAll(".admin-topics__name")].map((el) => el.textContent);
    expect(names).toEqual(["Pokémon", "Indies"]);
    await userEvent.click(screen.getByRole("button", { name: "New topic" }));
    await userEvent.type(screen.getByLabelText("Name"), "Soulslikes");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(deps.create).toHaveBeenCalledWith({ name: "Soulslikes", section: "anime" });
    expect(await screen.findByText("Soulslikes created")).toBeInTheDocument();
  });

  it("renames, and lets the owner alone delete an empty topic", async () => {
    wrap(<TopicsPane adminRole="owner" deps={deps} />);
    const row = (await screen.findByText("Indies")).closest("li")!;
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Rename" }));
    const field = within(row).getByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Indie games");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(deps.rename).toHaveBeenCalledWith("t1", "Indie games");
    const empty = screen.getByText("Pokémon").closest("li")!;
    await userEvent.click(within(empty).getByRole("button", { name: "Delete" }));
    expect(deps.remove).toHaveBeenCalledWith("t2");
  });

  it("leaves deleting to the owner", async () => {
    wrap(<TopicsPane adminRole="moderator" deps={deps} />);
    await screen.findByText("Pokémon");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("ModeratorsPane", () => {
  const kenji: Moderator = {
    uid: "u7",
    name: "kenji",
    photoUrl: null,
    email: "kenji@example.com",
    appointedAt: Date.UTC(2026, 7, 12),
  };
  let deps: ModeratorsDeps;
  beforeEach(() => {
    deps = {
      load: vi.fn(async () => ({ moderators: [kenji] })),
      find: vi.fn(async () => ({
        people: [{ uid: "u8", name: "mariia", email: "mariia@example.com", photoUrl: null }],
      })),
      appoint: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
  });

  it("lists the owner and the moderators, and appoints somebody found by name after asking", async () => {
    wrap(<ModeratorsPane deps={deps} />);
    expect(await screen.findByText("kenji")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox"), "mar");
    await userEvent.click(await screen.findByRole("button", { name: "Appoint" }));
    expect(
      screen.getByText("Make mariia a moderator? They'll see reports and proposals."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("group")).getByRole("button", { name: "Appoint" }),
    );
    expect(deps.appoint).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "u8", name: "mariia" }),
    );
    expect(await screen.findByText("mariia is a moderator")).toBeInTheDocument();
  });

  it("removes after asking, with Undo", async () => {
    wrap(<ModeratorsPane deps={deps} />);
    await screen.findByText("kenji");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(
      within(screen.getByRole("group")).getByRole("button", { name: "Remove" }),
    );
    expect(deps.remove).toHaveBeenCalledWith("u7");
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(deps.appoint).toHaveBeenCalledWith(kenji);
  });
});
