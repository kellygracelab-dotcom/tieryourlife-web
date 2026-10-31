import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
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
      approveAsTopic: vi.fn(async (_id: string, approval: { section: string; name?: string }) => ({
        topic: topic("t7", approval.name ?? "Street food", { section: approval.section }),
        proposal: null,
      })),
      declineSection: vi.fn(async () => undefined),
      mergeSection: vi.fn(async () => undefined),
      mergeIntoTopic: vi.fn(async (_id: string, into: string) => ({
        topic: topic(into, "Street food", { section: "food" }),
        proposal: null,
      })),
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
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a section" }));
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
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a section" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("That didn’t go through.");
  });

  it("opens Approve as a panel, and approves as a section, renamed if asked", async () => {
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(within(card).getByRole("radio", { name: "Approve as a section" })).toBeChecked();
    expect(within(card).getByText("6 waiting lists move with it.")).toBeInTheDocument();
    const name = within(card).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Street food");
    expect(within(card).getByText("11/24")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(deps.approveSection).not.toHaveBeenCalled();

    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.clear(within(card).getByRole("textbox", { name: "Name" }));
    await userEvent.type(within(card).getByRole("textbox", { name: "Name" }), "Street eats");
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a section" }));
    expect(deps.approveSection).toHaveBeenCalledWith("street-food", { name: "Street eats" });
    expect(await screen.findByText("Street eats approved")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Street food" })).toBeNull();
  });

  it("approves as a topic in the section the lists were filed under, and opens it", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/proposals"]}>
        <Routes>
          <Route
            path="/admin/proposals"
            element={<ProposalsPane adminRole="moderator" deps={deps} />}
          />
          <Route path="/s/:id/t/:topic" element={<h1>The topic</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    const where = within(card).getByRole("combobox", { name: "Section" });
    expect(where).toHaveValue("food");
    await userEvent.selectOptions(where, "games");
    expect(within(card).getByRole("radio", { name: "Approve as a topic in" })).toBeChecked();
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a topic" }));
    expect(deps.approveAsTopic).toHaveBeenCalledWith("street-food", { section: "games" });
    expect(
      await screen.findByText("Street food approved as a topic in Games · 6 lists moved"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("heading", { name: "The topic" })).toBeInTheDocument();
  });

  it("says a topic's name is taken under the name, and merges into that topic", async () => {
    deps.approveAsTopic = vi.fn(async () => {
      throw new ApiFailure({ kind: "invalid", detail: null, code: "NAME_TAKEN", id: "t1" });
    });
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(card).getByRole("radio", { name: "Approve as a topic in" }));
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a topic" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Street food already exists in Food",
    );
    expect(within(card).getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Not somebody else's decision: the queue is not read again.
    expect(deps.sections).toHaveBeenCalledTimes(1);
    await userEvent.click(within(card).getByRole("button", { name: "Merge into it" }));
    expect(deps.mergeIntoTopic).toHaveBeenCalledWith("street-food", "t1");
    expect(deps.mergeSection).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Street food merged into Street food in Food · 6 lists moved"),
    ).toBeInTheDocument();
  });

  it("names the section the taken topic is in, and merges into it there", async () => {
    deps.approveAsTopic = vi.fn(async () => {
      throw new ApiFailure({
        kind: "invalid",
        detail: null,
        code: "NAME_TAKEN",
        id: "t1",
        section: "games",
      });
    });
    deps.mergeIntoTopic = vi.fn(async () => ({ topic: null, proposal: null }));
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(card).getByRole("radio", { name: "Approve as a topic in" }));
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a topic" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Street food already exists in Games",
    );
    await userEvent.click(within(card).getByRole("button", { name: "Merge into it" }));
    expect(
      await screen.findByText("Street food merged into Street food in Games · 6 lists moved"),
    ).toBeInTheDocument();
  });

  it("says where the backend put the topic when it answers with an earlier approval", async () => {
    deps.approveAsTopic = vi.fn(async () => ({
      topic: topic("t7", "Street food", { section: "food" }),
      proposal: null,
    }));
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Section" }), "games");
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a topic" }));
    expect(
      await screen.findByText("Street food approved as a topic in Food · 6 lists moved"),
    ).toBeInTheDocument();
  });

  it("merges into the section when an older backend names no topic, for the owner", async () => {
    deps.approveAsTopic = vi.fn(async () => {
      throw new ApiFailure({ kind: "invalid", detail: null, code: "NAME_TAKEN" });
    });
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(card).getByRole("radio", { name: "Approve as a topic in" }));
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a topic" }));
    await userEvent.click(await within(card).findByRole("button", { name: "Merge into it" }));
    expect(deps.mergeSection).toHaveBeenCalledWith("street-food", "food");
    expect(await screen.findByText("Street food merged into Food")).toBeInTheDocument();
  });

  it("says before anybody decides that a topic has the name, and merges into it", async () => {
    deps.sections = vi.fn(async () => ({
      sections: [
        {
          ...proposed,
          nameClash: {
            kind: "topic" as const,
            id: "t5",
            name: "Street food",
            section: "food",
            sectionName: "Food",
          },
        },
      ],
    }));
    render(
      <MemoryRouter initialEntries={["/admin/proposals"]}>
        <Routes>
          <Route
            path="/admin/proposals"
            element={<ProposalsPane adminRole="moderator" deps={deps} />}
          />
          <Route path="/s/:id/t/:topic" element={<h1>The topic</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    expect(within(card).getByText("Street food already exists in Food")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Merge into it" }));
    expect(deps.mergeIntoTopic).toHaveBeenCalledWith("street-food", "t5");
    await screen.findByText("Street food merged into Street food in Food · 6 lists moved");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("heading", { name: "The topic" })).toBeInTheDocument();
  });

  it("says why a topic refused the merge, and keeps the card", async () => {
    deps.sections = vi.fn(async () => ({
      sections: [
        {
          ...proposed,
          nameClash: {
            kind: "topic" as const,
            id: "t5",
            name: "Street food",
            section: "food",
            sectionName: null,
          },
        },
      ],
    }));
    deps.mergeIntoTopic = vi.fn(async () => {
      throw new ApiFailure({ kind: "invalid", detail: "topic", code: "INVALID" });
    });
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Merge into it" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Street food can’t take it now: it isn’t open, or its section is hidden.",
    );
    expect(screen.getByRole("heading", { name: "Street food" })).toBeInTheDocument();
  });

  it("names a section with the same name, and leaves its merge to the owner", async () => {
    deps.sections = vi.fn(async () => ({
      sections: [
        { ...proposed, nameClash: { kind: "section" as const, id: "food", name: "Street food" } },
      ],
    }));
    const { unmount } = wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    let card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    expect(
      within(card).getByText("A section called Street food already exists"),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Merge into it" })).toBeNull();
    unmount();

    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Merge into it" }));
    expect(deps.mergeSection).toHaveBeenCalledWith("street-food", "food");
  });

  it("says a section's name is taken, and keeps Merge into it from a moderator", async () => {
    deps.approveSection = vi.fn(async () => {
      throw new ApiFailure({ kind: "invalid", detail: null, code: "NAME_TAKEN", id: "food" });
    });
    wrap(<ProposalsPane adminRole="moderator" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a section" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "A section called Street food already exists",
    );
    expect(within(card).queryByRole("button", { name: "Merge into it" })).toBeNull();
    // Another name is another try: the clash is no longer said.
    await userEvent.type(within(card).getByRole("textbox", { name: "Name" }), "s");
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  it("merges into the section a name clashes with, for the owner", async () => {
    deps.approveSection = vi.fn(async () => {
      throw new ApiFailure({ kind: "invalid", detail: null, code: "NAME_TAKEN", id: "food" });
    });
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Street food" })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await userEvent.click(within(card).getByRole("button", { name: "Approve as a section" }));
    await userEvent.click(await within(card).findByRole("button", { name: "Merge into it" }));
    expect(deps.mergeSection).toHaveBeenCalledWith("street-food", "food");
  });

  it("shows a proposed topic's own picture in its square", async () => {
    deps.topics = vi.fn(async () => ({
      topics: [{ ...pendingTopic, pictureUrl: "https://pictures.test/speedruns.webp" }],
    }));
    wrap(<ProposalsPane adminRole="owner" deps={deps} />);
    const card = (await screen.findByRole("heading", { name: "Speedruns" })).closest("li")!;
    expect(card.querySelector(".proposal__square img")).toHaveAttribute(
      "src",
      "https://pictures.test/speedruns.webp",
    );
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
          topic("t1", "Indies", {
            followerCount: 2,
            pictureUrl: "https://pictures.test/indies.webp",
          }),
          topic("t2", "Pokémon", { listCount: 0 }),
        ],
      })),
      create: vi.fn(async (draft) => topic("t3", draft.name)),
      edit: vi.fn(async (id, changes) => topic(id, changes.name ?? "Indies")),
      remove: vi.fn(async () => undefined),
    };
  });

  it("lists a section's topics, most followed first, and creates one directly", async () => {
    wrap(<TopicsPane adminRole="owner" deps={deps} editor={editorFakes()} />);
    expect(await screen.findByText("Pokémon")).toBeInTheDocument();
    const names = [...document.querySelectorAll(".admin-topics__name")].map((el) => el.textContent);
    expect(names).toEqual(["Pokémon", "Indies"]);
    await userEvent.click(screen.getByRole("button", { name: "New topic" }));
    const dialog = screen.getByRole("dialog", { name: "New topic" });
    expect(within(dialog).getByRole("button", { name: /Add a picture/ })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Soulslikes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(deps.create).toHaveBeenCalledWith({ name: "Soulslikes", section: "anime" });
    expect(await screen.findByText("Soulslikes created")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws a topic's own picture in its square, and its section's icon without one", async () => {
    wrap(<TopicsPane adminRole="owner" deps={deps} />);
    const pictured = (await screen.findByText("Indies")).closest("li")!;
    expect(pictured.querySelector(".admin-topics__square img")).toHaveAttribute(
      "src",
      "https://pictures.test/indies.webp",
    );
    const plain = screen.getByText("Pokémon").closest("li")!;
    expect(plain.querySelector(".admin-topics__square img")).toBeNull();
    expect(plain.querySelector(".admin-topics__square .ms")).not.toBeNull();
  });

  it("renames in its dialog, and lets the owner alone delete an empty topic", async () => {
    wrap(<TopicsPane adminRole="owner" deps={deps} editor={editorFakes()} />);
    const row = (await screen.findByText("Indies")).closest("li")!;
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit topic" });
    const field = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Indie games");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(deps.edit).toHaveBeenCalledWith("t1", { name: "Indie games" });
    expect(await screen.findByText("Indie games saved")).toBeInTheDocument();
    // A rename reads the topics again: the rows are back only once they have come.
    const empty = (await screen.findByText("Pokémon")).closest("li")!;
    await userEvent.click(within(empty).getByRole("button", { name: "Delete" }));
    expect(deps.remove).toHaveBeenCalledWith("t2");
  });

  it("leaves deleting to the owner", async () => {
    wrap(<TopicsPane adminRole="moderator" deps={deps} />);
    await screen.findByText("Pokémon");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("reads another section's topics, and closes the dialog on Cancel", async () => {
    wrap(<TopicsPane adminRole="owner" deps={deps} editor={editorFakes()} />);
    await screen.findByText("Pokémon");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Section" }), "games");
    expect(deps.load).toHaveBeenLastCalledWith("games");
    await userEvent.click(await screen.findByRole("button", { name: "New topic" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says a delete that did not go through, and topics that did not come", async () => {
    deps.remove = vi.fn(async () => {
      throw new ApiFailure({ kind: "offline" });
    });
    deps.load = vi
      .fn<TopicsDeps["load"]>()
      .mockResolvedValueOnce({ topics: [topic("t2", "Pokémon", { listCount: 0 })] })
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValue({ topics: [] });
    wrap(<TopicsPane adminRole="owner" deps={deps} />);
    const row = (await screen.findByText("Pokémon")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn’t go through.");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Section" }), "games");
    expect(await screen.findByText("Couldn’t load this. Try again.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No topics in this section yet.")).toBeInTheDocument();
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
