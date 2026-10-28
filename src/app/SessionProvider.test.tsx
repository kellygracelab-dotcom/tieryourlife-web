import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/account";
import { useSession, useShowFace } from "./session";
import { SessionProvider } from "./SessionProvider";

vi.mock("../lib/account", () => ({ subscribeToAccount: vi.fn(), currentAccount: vi.fn() }));
vi.mock("../lib/firebase", () => ({ signOutToGuest: vi.fn() }));
vi.mock("../lib/signIn", () => ({
  sessionStash: { take: vi.fn(), put: vi.fn() },
  signInWithGoogle: vi.fn(),
  completeSignIn: vi.fn(),
}));
vi.mock("../lib/api", () => ({ carryGuest: vi.fn() }));

function Probe() {
  const { account } = useSession();
  return <output>{account === null ? "unknown" : `${account.kind}:${account.uid ?? "-"}`}</output>;
}

describe("SessionProvider", () => {
  it("starts unknown, follows the account, finishes a redirect once, and lets go on unmount", () => {
    let listener: ((account: Account) => void) | null = null;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((next: (account: Account) => void) => {
      listener = next;
      return unsubscribe;
    });
    const complete = vi.fn(async () => null);
    const { unmount } = render(
      <SessionProvider subscribe={subscribe} complete={complete}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("unknown");
    expect(complete).toHaveBeenCalledTimes(1);

    act(() => listener?.({ kind: "guest", uid: "g1" }));
    expect(screen.getByRole("status")).toHaveTextContent("guest:g1");
    act(() => listener?.({ kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null }));
    expect(screen.getByRole("status")).toHaveTextContent("signedIn:u1");

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("is a guest who cannot sign in when rendered without a provider", async () => {
    function Bare() {
      const { account, signIn } = useSession();
      return (
        <button onClick={() => void signIn().then((o) => (document.title = o.kind))}>
          {account?.kind}
        </button>
      );
    }
    render(<Bare />);
    expect(screen.getByRole("button")).toHaveTextContent("guest");
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(document.title).toBe("failed");
  });

  it("puts a face chosen a moment ago on the account until the account's own is put back", async () => {
    let listener: ((account: Account) => void) | null = null;
    const subscribe = (next: (account: Account) => void) => {
      listener = next;
      return () => undefined;
    };
    function Face() {
      const { account } = useSession();
      const show = useShowFace();
      return (
        <>
          <output>{account?.kind === "signedIn" ? String(account.photoUrl) : "nobody"}</output>
          <button onClick={() => show("data:image/jpeg;base64,AA")}>Cut</button>
          <button onClick={() => show(null)}>Letter</button>
          <button onClick={() => show(undefined)}>Back</button>
        </>
      );
    }
    render(
      <SessionProvider subscribe={subscribe} complete={async () => null}>
        <Face />
      </SessionProvider>,
    );
    const shown = () => screen.getByRole("status");
    act(() => listener?.({ kind: "signedIn", uid: "u1", displayName: "D", photoUrl: "https://a" }));
    expect(shown()).toHaveTextContent("https://a");

    await userEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(shown()).toHaveTextContent("data:image/jpeg;base64,AA");
    await userEvent.click(screen.getByRole("button", { name: "Letter" }));
    expect(shown()).toHaveTextContent("null");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shown()).toHaveTextContent("https://a");

    // A guest has no face to wear.
    await userEvent.click(screen.getByRole("button", { name: "Cut" }));
    act(() => listener?.({ kind: "guest", uid: "g1" }));
    expect(shown()).toHaveTextContent("nobody");
  });

  it("shows nothing new without a provider", async () => {
    function Bare() {
      const show = useShowFace();
      return <button onClick={() => show("data:x")}>Cut</button>;
    }
    render(<Bare />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
