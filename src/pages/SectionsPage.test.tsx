import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { SectionStats } from "../api/sections";
import { SessionContext, type Session } from "../app/session";
import { createSectionsStore, type SectionsDeps } from "../features/sections/useSections";
import { memoryStore } from "../lib/storage";
import { SectionsPage, type ProposingDeps } from "./SectionsPage";

vi.mock("../lib/api", async () => (await import("../test/apiMock")).apiStubs());

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 10,
  followerCount: 2,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "D",
  photoUrl: null,
};
const guest: Session["account"] = { kind: "guest", uid: null };

const waiting = (id: string, name: string) =>
  stats(id, { name, status: "pending", proposerUid: "u1", fileUnder: "games", listCount: 0 });

const sectionsDeps = {
  load: vi.fn<SectionsDeps["load"]>(),
  follow: vi.fn<SectionsDeps["follow"]>(),
  unfollow: vi.fn<SectionsDeps["unfollow"]>(),
};

let proposing: ProposingDeps;

function open({
  account = member,
  path = "/s",
  signIn = vi.fn<Session["signIn"]>(async () => ({ kind: "cancelled" })),
}: { account?: Session["account"]; path?: string; signIn?: Session["signIn"] } = {}) {
  const store = createSectionsStore({ ...sectionsDeps, now: () => 0 });
  const router = createMemoryRouter(
    [
      { path: "/s", element: <SectionsPage store={store} proposing={proposing} /> },
      { path: "/s/:id", element: <h1>A section</h1> },
    ],
    { initialEntries: [path] },
  );
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return { router, store, signIn };
}

const grid = () => within(screen.getByRole("navigation", { name: "All sections" }));

beforeEach(() => {
  sectionsDeps.load.mockReset();
  sectionsDeps.load.mockResolvedValue({
    sections: [
      stats("games"),
      stats("anime"),
      stats("other"),
      waiting("street-food", "Street food"),
    ],
  });
  proposing = {
    propose: vi.fn(async () => waiting("pets", "Pets")),
    withdraw: vi.fn(async () => undefined),
    editor: {
      check: vi.fn(async () => ({ free: true })),
      upload: vi.fn(async () => ({ pictureId: "p", previewUrl: "https://p" })),
      crop: vi.fn(async () => new Blob(["webp"], { type: "image/webp" })),
      keep: memoryStore(),
    },
  };
});

describe("All sections: proposing", () => {
  it("ends with Propose a section, and puts the proposer's waiting one first", async () => {
    open();
    await screen.findByText("4 sections");
    const tiles = grid().getAllByRole("button").concat(grid().getAllByRole("link"));
    expect(tiles[0]).toHaveTextContent("Street food");
    expect(grid().getByRole("button", { name: /Street food/ })).toHaveTextContent("Waiting");
    const propose = screen.getByRole("button", { name: "Propose a section" });
    expect(propose).toHaveClass("btn--outlined");
    expect(propose.querySelector(".ms")).toHaveTextContent("add");
    expect(
      screen.getByRole("navigation", { name: "All sections" }).compareDocumentPosition(propose) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("asks a guest to sign in first, then opens the form", async () => {
    const signIn = vi.fn<Session["signIn"]>(async () => ({ kind: "signedIn", switched: false }));
    open({ account: guest, signIn });
    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    expect(
      screen.getByRole("dialog", { name: "Sign in to propose a section" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Google/ }));
    expect(await screen.findByRole("dialog", { name: "Propose a section" })).toBeInTheDocument();
    expect(signIn).toHaveBeenCalled();
  });

  it("leaves a guest who does not sign in where they were", async () => {
    open({ account: guest });
    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    await userEvent.click(screen.getByRole("button", { name: /Google/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the form for a member, counting what already waits; Cancel closes it", async () => {
    open();
    await screen.findByText("4 sections");
    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    const form = screen.getByRole("dialog", { name: "Propose a section" });
    expect(within(form).getByText("You have 1 of 3 proposals waiting.")).toBeInTheDocument();
    // The approved ones to file under; a waiting one is no place for lists.
    expect(
      within(within(form).getByRole("combobox"))
        .getAllByRole("option")
        .map((one) => one.textContent),
    ).toEqual(["Anime", "Games", "Other"]);
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so once proposed, and reads the sections again so the new one waits first", async () => {
    open();
    await screen.findByText("4 sections");
    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    const picture = new File(["x"], "pets.jpg", { type: "image/jpeg" });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:p" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    await userEvent.upload(screen.getByLabelText("Choose a picture"), picture);
    const image = document.querySelector<HTMLImageElement>(".crop img")!;
    Object.defineProperty(image, "naturalWidth", { value: 1600 });
    Object.defineProperty(image, "naturalHeight", { value: 1000 });
    image.dispatchEvent(new Event("load"));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Pets");
    sectionsDeps.load.mockResolvedValue({
      sections: [
        stats("games"),
        stats("anime"),
        stats("other"),
        waiting("street-food", "Street food"),
        waiting("pets", "Pets"),
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Propose" }));
    expect(await screen.findByText("Proposed. A moderator will look at it.")).toBeInTheDocument();
    expect(proposing.propose).toHaveBeenCalledWith({
      name: "Pets",
      icon: "category",
      pictureId: "p",
      fileUnder: "other",
    });
    await screen.findByText("5 sections");
    expect(sectionsDeps.load).toHaveBeenCalledTimes(2);
    expect(grid().getByRole("button", { name: /Pets/ })).toHaveTextContent("Waiting");
  });

  it("with three waiting, shows them in the small dialog instead of the form", async () => {
    sectionsDeps.load.mockResolvedValue({
      sections: [
        stats("games"),
        stats("other"),
        waiting("a", "Street food"),
        waiting("b", "Board games"),
        waiting("c", "Bakeries"),
      ],
    });
    const { router } = open();
    await screen.findByText("5 sections");
    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    const dialog = screen.getByRole("dialog", { name: "3 proposals are waiting" });
    expect(dialog).toHaveAccessibleDescription(
      "You can propose another once a moderator has looked at one of them.",
    );
    const links = within(within(dialog).getByRole("list", { name: "Your proposals" })).getAllByRole(
      "link",
    );
    expect(links.map((one) => one.textContent)).toEqual(["Street food", "Board games", "Bakeries"]);
    expect(links[1]).toHaveAttribute("href", "/s?waiting=b");
    expect(screen.queryByRole("dialog", { name: "Propose a section" })).toBeNull();

    // Each is a way to its waiting tile, opened.
    await userEvent.click(links[1]!);
    expect(router.state.location.search).toBe("?waiting=b");
    expect(await screen.findByRole("dialog", { name: "Board games" })).toBeInTheDocument();
  });

  it("swaps the form for the small dialog when the backend says three already wait", async () => {
    proposing.propose = vi.fn(async () => {
      throw new ApiFailure({ kind: "invalid", detail: null, code: "TOO_MANY_PENDING" });
    });
    open();
    await screen.findByText("4 sections");
    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:p" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    await userEvent.upload(
      screen.getByLabelText("Choose a picture"),
      new File(["x"], "p.jpg", { type: "image/jpeg" }),
    );
    const image = document.querySelector<HTMLImageElement>(".crop img")!;
    Object.defineProperty(image, "naturalWidth", { value: 1600 });
    Object.defineProperty(image, "naturalHeight", { value: 1000 });
    image.dispatchEvent(new Event("load"));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Pets");
    await userEvent.click(screen.getByRole("button", { name: "Propose" }));
    expect(
      await screen.findByRole("dialog", { name: "3 proposals are waiting" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("All sections: a waiting tile", () => {
  it("opens the sheet that says what happens next, and closes it", async () => {
    const { router } = open();
    await userEvent.click(await grid().findByRole("button", { name: /Street food/ }));
    const sheet = screen.getByRole("dialog", { name: "Street food" });
    expect(sheet).toHaveTextContent(
      "A moderator will look at it. Your lists show here once it's approved; until then they're in Games.",
    );
    expect(router.state.location.search).toBe("?waiting=street-food");
    await userEvent.click(within(sheet).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.state.location.search).toBe("");
  });

  it("withdraws after asking once more, and reads the sections again", async () => {
    open({ path: "/s?waiting=street-food" });
    const sheet = await screen.findByRole("dialog", { name: "Street food" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    expect(sheet).toHaveTextContent("Withdraw “Street food”? Your lists stay in Games.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(proposing.withdraw).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    // A withdrawn proposal comes back declined, which no tile shows.
    sectionsDeps.load.mockResolvedValue({
      sections: [
        stats("games"),
        stats("anime"),
        stats("other"),
        { ...waiting("street-food", "Street food"), status: "declined" },
      ],
    });
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    expect(proposing.withdraw).toHaveBeenCalledWith("street-food");
    expect(await screen.findByText("Proposal withdrawn.")).toBeInTheDocument();
    await screen.findByText("3 sections");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(grid().queryByRole("button")).toBeNull();
  });

  it("says when a moderator decided it first, and when the withdraw failed", async () => {
    proposing.withdraw = vi
      .fn<ProposingDeps["withdraw"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "conflict" }));
    open({ path: "/s?waiting=street-food" });
    const sheet = await screen.findByRole("dialog", { name: "Street food" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Couldn’t withdraw it. Try again.",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Withdraw" }));
    expect(await screen.findByText("Someone else already decided this one.")).toBeInTheDocument();
    expect(sectionsDeps.load).toHaveBeenCalledTimes(2);
  });

  it("is a link like any other tile for somebody else's section", async () => {
    open();
    await screen.findByText("4 sections");
    expect(grid().getByRole("link", { name: /Games/ })).toHaveAttribute("href", "/s/games");
  });
});
