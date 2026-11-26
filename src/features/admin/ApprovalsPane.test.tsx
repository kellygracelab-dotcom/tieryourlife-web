import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalList } from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import { SessionContext, type Session } from "../../app/session";
import { ApprovalsPane, type Approve, type LoadApprovals, type Remove } from "./ApprovalsPane";

vi.mock("../../lib/api", async () => ({
  ...(await import("../../test/apiMock")).apiStubs(),
}));

const staff: Session["account"] = {
  kind: "signedIn",
  uid: "mod1",
  displayName: "Danylo",
  photoUrl: null,
};

const DAY = 24 * 60 * 60 * 1000;

const waiting = (id: string, extra: Partial<ApprovalList> = {}): ApprovalList => ({
  id,
  title: `List ${id}`,
  authorUid: "u2",
  authorName: "Fern",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 12,
  coverImageUrl: "https://img/cover.jpg",
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  publishedAt: Date.now() - 2 * DAY,
  underReview: false,
  publishedBy: { uid: "u2", name: "Fern" },
  ...extra,
});

const load = vi.fn<LoadApprovals>();
const approve = vi.fn<Approve>();
const remove = vi.fn<Remove>();

const open = () =>
  render(
    <SessionContext.Provider
      value={{
        account: staff,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <ApprovalsPane load={load} approve={approve} remove={remove} />
    </SessionContext.Provider>,
  );

const cards = () =>
  within(screen.getByRole("list", { name: "Awaiting approval" })).getAllByRole("listitem");

beforeEach(() => {
  load.mockReset();
  approve.mockReset();
  remove.mockReset();
});

describe("ApprovalsPane: new lists waiting before the feed (Danylo, 26.11)", () => {
  it("lists them as the backend sends them, the longest waiting first, with cover, title, author, cards and a link", async () => {
    load.mockResolvedValue({
      lists: [
        waiting("old", { publishedAt: Date.now() - 3 * DAY, underReview: true }),
        waiting("new", { itemCount: 1, coverImageUrl: null, previewImages: ["https://img/p.jpg"] }),
      ],
    });
    open();
    expect(await screen.findByText("2 lists waiting")).toBeInTheDocument();
    const [first, second] = cards();
    expect(within(first!).getByRole("heading", { name: "List old" })).toBeInTheDocument();
    expect(within(first!).getByText("by Fern")).toBeInTheDocument();
    expect(within(first!).getByText("12 cards")).toBeInTheDocument();
    expect(within(first!).getByText("Under review")).toBeInTheDocument();
    expect(within(first!).getByText("Published 3 days ago")).toBeInTheDocument();
    expect(within(first!).getByRole("link", { name: "Open list" })).toHaveAttribute(
      "href",
      "/l/old",
    );
    expect(first!.querySelector("img")).toHaveAttribute("src", "https://img/cover.jpg");
    expect(within(second!).getByText("1 card")).toBeInTheDocument();
    expect(within(second!).queryByText("Under review")).toBeNull();
    // No cover: its first card's picture stands in.
    expect(second!.querySelector("img")).toHaveAttribute("src", "https://img/p.jpg");
  });

  it("approves one: it goes from the queue, said so", async () => {
    load.mockResolvedValue({ lists: [waiting("a"), waiting("b")] });
    approve.mockResolvedValue();
    open();
    await screen.findByText("2 lists waiting");
    await userEvent.click(within(cards()[0]!).getByRole("button", { name: "Approve" }));
    expect(approve).toHaveBeenCalledWith("a");
    expect(await screen.findByText("Approved. It’s in the feed now.")).toBeInTheDocument();
    expect(screen.getByText("1 list waiting")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "List a" })).toBeNull();
  });

  it("removes one as a report does, asking first whether to ban its author", async () => {
    load.mockResolvedValue({ lists: [waiting("a")] });
    remove.mockResolvedValue();
    open();
    await screen.findByText("1 list waiting");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const ask = screen.getByRole("group", { name: "Take it down. Ban the author?" });
    expect(within(ask).getByRole("button", { name: "No ban" })).toHaveFocus();
    await userEvent.click(within(ask).getByRole("button", { name: "A week" }));
    await userEvent.click(within(ask).getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith("a", "week");
    expect(await screen.findByText(/^Taken down\. Fern banned/)).toBeInTheDocument();
    expect(screen.getAllByText("Nothing waiting").length).toBeGreaterThan(0);
  });

  it("keeps a list whose decision failed, with Try again sending the same", async () => {
    load.mockResolvedValue({ lists: [waiting("a")] });
    approve.mockRejectedValueOnce(new ApiFailure({ kind: "offline" })).mockResolvedValueOnce();
    open();
    await screen.findByText("1 list waiting");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const bar = await screen.findByRole("alert");
    await userEvent.click(within(bar).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Approved. It’s in the feed now.")).toBeInTheDocument();
  });

  it("says when nothing waits, and that links already work", async () => {
    load.mockResolvedValue({ lists: [] });
    open();
    expect(
      await screen.findByText(
        "New lists from people wait here before they reach the feed. Their links already work.",
      ),
    ).toBeInTheDocument();
  });

  it("says when the queue cannot be read, with Try again", async () => {
    load.mockRejectedValueOnce(new ApiFailure({ kind: "offline" })).mockResolvedValueOnce({
      lists: [waiting("a")],
    });
    open();
    expect(await screen.findByText("Couldn’t load the lists waiting.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1 list waiting")).toBeInTheDocument();
  });
});
