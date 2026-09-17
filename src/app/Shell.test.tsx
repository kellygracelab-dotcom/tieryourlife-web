import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./routes";
import { SessionContext, type Session } from "./session";

vi.mock("../lib/api", () => ({
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

describe("Shell theme", () => {
  it("offers System, Light and Dark under More, keeps the choice and puts it on the page", async () => {
    open({});
    await userEvent.click(screen.getByLabelText("More"));
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getByRole("radio", { name: "System" })).toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("tyl:theme")).toBe("dark");
    expect(within(group).getByRole("radio", { name: "Dark" })).toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("tyl:theme")).toBeNull();
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
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("gives a signed-in person their initial, their rankings and a way out", async () => {
    const signOut = vi.fn(async () => undefined);
    open({
      account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null },
      signOut,
    });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.getByText("D")).toHaveClass("face--initial");
    expect(screen.getByText("Danylo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your rankings" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("link", { name: "My lists" })).toHaveAttribute("href", "/me/lists");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
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
