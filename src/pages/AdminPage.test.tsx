import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import { SessionContext, type Session } from "../app/session";
import { resetModeratorForTests } from "../features/moderation/useModerator";
import { AdminPage } from "./AdminPage";

const mocks = vi.hoisted(() => ({
  loadAdminSections: vi.fn(),
  loadReports: vi.fn(),
}));

vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  loadAdminSections: mocks.loadAdminSections,
  loadReports: mocks.loadReports,
}));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "D",
  photoUrl: null,
};

function open(path = "/admin", account: Session["account"] = member) {
  const router = createMemoryRouter(
    [
      { path: "/admin", element: <AdminPage /> },
      { path: "/admin/:pane", element: <AdminPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <SessionContext.Provider
      value={{
        account,
        signIn: async () => ({ kind: "cancelled" }),
        signOut: async () => undefined,
        refresh: () => undefined,
      }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
}

const panes = () =>
  within(screen.getByRole("navigation", { name: "Admin" }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));

beforeEach(() => {
  resetModeratorForTests();
  mocks.loadAdminSections.mockReset();
  mocks.loadReports.mockReset();
  mocks.loadReports.mockResolvedValue({ reports: [] });
  // A wide window: the list of panes beside the pane.
  window.innerWidth = 1280;
});

describe("AdminPage", () => {
  it("opens all nine panes to the owner, with Reports first", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: "owner", version: 1 });
    open();
    expect(await screen.findByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(panes()).toEqual([
      "/admin/reports",
      "/admin/proposals",
      "/admin/sections",
      "/admin/topics",
      "/admin/lists",
      "/admin/anonymous",
      "/admin/house",
      "/admin/searches",
      "/admin/moderators",
    ]);
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("opens House lists to the owner", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: "owner", version: 1 });
    open("/admin/house");
    expect(await screen.findByRole("heading", { name: "House lists" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "House lists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens House lists to a moderator too", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: "moderator", version: 1 });
    open("/admin/house");
    expect(await screen.findByRole("heading", { name: "House lists" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "House lists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not open House lists to a signed-in person the backend gives no role", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: null, version: 1 });
    mocks.loadReports.mockRejectedValue(new ApiFailure({ kind: "notYours" }));
    open("/admin/house");
    expect(await screen.findByText("This page isn’t available.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "House lists" })).toBeNull();
    expect(screen.queryByRole("link", { name: "House lists" })).toBeNull();
  });

  it("leaves a moderator without the owner's panes, even at their address", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: "moderator", version: 1 });
    open("/admin/moderators");
    await screen.findByRole("heading", { name: "Admin" });
    expect(panes()).toEqual([
      "/admin/reports",
      "/admin/proposals",
      "/admin/sections",
      "/admin/topics",
      "/admin/lists",
      "/admin/house",
      "/admin/searches",
    ]);
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("opens Lists to a moderator", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: "moderator", version: 1 });
    open("/admin/lists");
    expect(await screen.findByRole("heading", { name: "Lists" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute("aria-current", "page");
  });

  it("is not available to anybody else: a guest, or an account the backend names nobody", async () => {
    open("/admin", { kind: "guest", uid: null });
    expect(screen.getByText("This page isn’t available.")).toBeInTheDocument();
  });

  it("says the same to a signed-in person the backend gives no role", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [], role: null, version: 1 });
    mocks.loadReports.mockRejectedValue(new ApiFailure({ kind: "notYours" }));
    open();
    expect(await screen.findByText("This page isn’t available.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
  });

  it("takes the one who may read the reports for the owner while the backend names no roles yet", async () => {
    mocks.loadAdminSections.mockResolvedValue({ sections: [] });
    open("/admin/moderators");
    expect(await screen.findByRole("heading", { name: "Moderators" })).toBeInTheDocument();
  });
});
