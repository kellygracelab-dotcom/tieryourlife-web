import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { QueuedList } from "../api/moderation";
import { SessionContext, type Session } from "../app/session";
import { resetModeratorForTests } from "../features/moderation/useModerator";
import { agoText, reasonCounts } from "../features/moderation/queue";
import { ModerationPage, type LeaveUp, type LoadQueue, type TakeDown } from "./ModerationPage";

vi.mock("../lib/api", () => ({
  loadReports: vi.fn(),
  takeDownList: vi.fn(),
  leaveListUp: vi.fn(),
}));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "mod1",
  displayName: "Danylo",
  photoUrl: null,
};

const queued = (listId: string, extra: Partial<QueuedList> = {}): QueuedList => ({
  listId,
  listTitle: `List ${listId}`,
  authorName: "someone",
  authorUid: "u2",
  authorPhotoUrl: null,
  coverImageUrl: "https://img/cover.jpg",
  reasons: ["sexual", "spam", "sexual"],
  notes: ["Note one", "Note two", "Note three", "Note four"],
  reportCount: 3,
  newestAtMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
  hidden: true,
  reviewed: false,
  ...extra,
});

const load = vi.fn<LoadQueue>();
const takeDown = vi.fn<TakeDown>();
const leaveUp = vi.fn<LeaveUp>();

const open = (account: Session["account"] = member) => {
  const routes: RouteObject[] = [
    {
      path: "/mod",
      element: <ModerationPage load={load} takeDown={takeDown} leaveUp={leaveUp} />,
    },
  ];
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/mod"] })} />
    </SessionContext.Provider>,
  );
};

beforeEach(() => {
  load.mockReset();
  takeDown.mockReset();
  leaveUp.mockReset();
  resetModeratorForTests();
  localStorage.clear();
});

describe("reasonCounts and agoText", () => {
  it("counts reasons most first and says how long ago", () => {
    expect(reasonCounts(["spam", "sexual", "sexual"])).toEqual([
      { reason: "sexual", count: 2 },
      { reason: "spam", count: 1 },
    ]);
    const now = Date.UTC(2026, 8, 17, 12);
    expect(agoText(now - 1000, now)).toBe("today");
    expect(agoText(now - 30 * 60 * 60 * 1000, now)).toBe("yesterday");
    expect(agoText(now - 5 * 24 * 60 * 60 * 1000, now)).toBe("5 days ago");
  });
});

describe("ModerationPage", () => {
  it("shows the queue to the moderator: counts, reasons, notes, pills, and a way to the list", async () => {
    load.mockResolvedValue({
      reports: [queued("l1"), queued("l2", { hidden: false, reviewed: true, notes: [] })],
    });
    open();
    expect(await screen.findByText("2 lists · 6 reports")).toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Reports" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    const first = cards[0]!;
    expect(first).toHaveTextContent("List l1");
    expect(first).toHaveTextContent("3 reports");
    expect(first).toHaveTextContent("Hidden while it waits");
    expect(first).toHaveTextContent("2 · Sexual content");
    expect(first).toHaveTextContent("1 · Spam or advertising");
    expect(first).toHaveTextContent("Note three");
    expect(first).not.toHaveTextContent("Note four");
    await userEvent.click(within(first).getByRole("button", { name: "Show 1 more note" }));
    expect(first).toHaveTextContent("Note four");
    expect(first).toHaveTextContent("2 days ago");
    expect(within(first).getByRole("link", { name: "Open list" })).toHaveAttribute("href", "/l/l1");
    expect(cards[1]).toHaveTextContent("Kept once already, so reports no longer hide it");
  });

  it("leaves a list up, and the card goes with a word in the snackbar", async () => {
    load.mockResolvedValue({ reports: [queued("l1")] });
    leaveUp.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Leave it up" }));
    expect(leaveUp).toHaveBeenCalledWith("l1");
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(screen.getByText("Left up. Reports no longer hide it.")).toBeInTheDocument();
  });

  it("takes a list down with a ban chosen inline, and asks once more for forever", async () => {
    load.mockResolvedValue({ reports: [queued("l1")] });
    takeDown.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Take it down" }));
    const panel = screen.getByRole("group", { name: "Take it down. Ban the author?" });
    expect(within(panel).getByRole("button", { name: "No ban" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Forever" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Take it down" }));
    const ask = screen.getByRole("dialog", { name: "Ban someone forever?" });
    expect(ask).toHaveTextContent("They will never publish again.");
    expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(ask).getByRole("button", { name: "Ban forever" }));
    expect(takeDown).toHaveBeenCalledWith("l1", "forever");
    expect(await screen.findByText("Taken down. someone banned forever.")).toBeInTheDocument();
  });

  it("takes a list down with no ban straight from the panel", async () => {
    load.mockResolvedValue({ reports: [queued("l1")] });
    takeDown.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Take it down" }));
    const panel = screen.getByRole("group", { name: "Take it down. Ban the author?" });
    await userEvent.click(within(panel).getByRole("button", { name: "A month" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Take it down" }));
    expect(takeDown).toHaveBeenCalledWith("l1", "month");
    expect(await screen.findByText("Taken down. someone banned for a month.")).toBeInTheDocument();
  });

  it("names a decision that could not be saved and keeps the card", async () => {
    load.mockResolvedValue({ reports: [queued("l1")] });
    leaveUp.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Leave it up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing changed");
    expect(screen.getByText("List l1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blurs covers on request and reveals one on click, remembering the choice", async () => {
    load.mockResolvedValue({ reports: [queued("l1")] });
    open();
    await screen.findByText("List l1");
    expect(screen.getByRole("button", { name: "Cover" })).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: "Blur covers" }));
    expect(localStorage.getItem("tyl:blur")).toBe("1");
    const cover = screen.getByRole("button", { name: "Show this cover" });
    expect(cover).toHaveClass("queue__cover--blurred");
    await userEvent.click(cover);
    expect(screen.getByRole("button", { name: "Cover" })).not.toHaveClass("queue__cover--blurred");
  });

  it("is not available to anyone the backend refuses, nor to a guest", async () => {
    load.mockRejectedValue(new ApiFailure({ kind: "notYours" }));
    open();
    expect(await screen.findByText("This page isn’t available.")).toBeInTheDocument();
    open({ kind: "guest", uid: "g1" });
    expect(screen.getAllByText("This page isn’t available.")).toHaveLength(2);
  });

  it("says when there is nothing to review, and names a failure to load", async () => {
    load.mockResolvedValueOnce({ reports: [] });
    open();
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(screen.getByText("Complaints about community lists arrive here.")).toBeInTheDocument();

    load.mockRejectedValueOnce(new ApiFailure({ kind: "offline" }));
    open({ ...member, uid: "mod2" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the reports");
  });
});
