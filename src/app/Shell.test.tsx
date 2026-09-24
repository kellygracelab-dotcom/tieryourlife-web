import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { routes } from "./routes";
import { SessionContext, type Session } from "./session";

vi.mock("../lib/api", () => ({
  followState: vi.fn(() => new Promise(() => undefined)),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  suggestedAuthors: vi.fn(() => new Promise(() => undefined)),
  loadReports: vi.fn(() => new Promise(() => undefined)),
  report: vi.fn(),
  loadMyLists: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadFeed: vi.fn(() => new Promise(() => undefined)),
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
}));

const open = (session: Partial<Session>) => {
  const value: Session = {
    account: { kind: "guest", uid: null },
    signIn: vi.fn(async () => ({ kind: "signedIn" as const, switched: false })),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(),
    ...session,
  };
  render(
    <SessionContext.Provider value={value}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </SessionContext.Provider>,
  );
  return value;
};

describe("Shell moderator", () => {
  it("shows Reports with a count only to the person the backend answers", async () => {
    const { resetModeratorForTests } = await import("../features/moderation/useModerator");
    resetModeratorForTests();
    const api = await import("../lib/api");
    vi.mocked(api.loadReports).mockResolvedValueOnce({
      reports: [
        {
          listId: "l1",
          listTitle: "One",
          authorName: "x",
          authorUid: null,
          authorPhotoUrl: null,
          coverImageUrl: null,
          reasons: ["spam"],
          notes: [],
          reportCount: 1,
          newestAtMs: 0,
          hidden: false,
          reviewed: false,
        },
      ],
    });
    open({ account: { kind: "signedIn", uid: "mod1", displayName: "Danylo", photoUrl: null } });
    await userEvent.click(screen.getByLabelText("Your account"));
    const reports = await screen.findByRole("link", { name: /Reports/ });
    expect(reports).toHaveAttribute("href", "/mod");
    expect(reports).toHaveTextContent("1");
    resetModeratorForTests();
  });
});

describe("Shell header", () => {
  // The theme and signing out are settings, and the header used to repeat both
  // behind three dots of its own.
  it("has no second menu: the theme is a setting, and a guest reaches settings from the foot", () => {
    open({});
    expect(screen.queryByLabelText("More")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
    const foot = within(screen.getByRole("contentinfo"));
    expect(foot.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Make a list" })).toHaveAttribute("href", "/new");
  });

  it("closes the account menu on a press anywhere else, on Escape, and after a choice", async () => {
    open({ account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null } });
    const button = screen.getByLabelText("Your account");
    const menu = button.closest("details")!;

    await userEvent.click(button);
    expect(menu.open).toBe(true);
    await userEvent.click(screen.getByRole("main"));
    expect(menu.open).toBe(false);

    await userEvent.click(button);
    expect(menu.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(menu.open).toBe(false);
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(screen.getByRole("link", { name: "My lists" }));
    expect(menu.open).toBe(false);
  });
});

describe("Shell account", () => {
  it("lets a guest sign in, and says so when that fails", async () => {
    const signIn = vi.fn(async () => ({
      kind: "failed" as const,
      code: "auth/network-request-failed",
    }));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in");
  });

  it("tells a person in another app's browser how to get out, instead of the plain failure", async () => {
    const signIn = vi.fn(async () => ({ kind: "failed" as const, code: IN_APP_BROWSER }));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Open this page in Chrome or Safari",
    );
  });

  it("stays quiet when the person changes their mind", async () => {
    const signIn = vi.fn(async () => ({ kind: "cancelled" as const }));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("leads a signed-in person to their settings", async () => {
    open({ account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null } });
    await userEvent.click(screen.getByLabelText("Your account"));
    const menu = within(screen.getByLabelText("Your account").closest("details")!);
    expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("gives a signed-in person their initial and their rankings, and leaves signing out to the settings", () => {
    open({ account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null } });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.getByText("D")).toHaveClass("face--initial");
    expect(screen.getByText("Danylo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your rankings" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("link", { name: "My lists" })).toHaveAttribute("href", "/me/lists");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("shows the Google photo when there is one, without telling Google where from", () => {
    open({
      account: { kind: "signedIn", uid: "u1", displayName: null, photoUrl: "https://p/x.jpg" },
    });
    const face = document.querySelector("img.face");
    expect(face).toHaveAttribute("src", "https://p/x.jpg");
    expect(face).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});
