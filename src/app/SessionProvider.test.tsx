import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "../lib/account";
import { useSession } from "./session";
import { SessionProvider } from "./SessionProvider";

vi.mock("../lib/account", () => ({ subscribeToAccount: vi.fn(), currentAccount: vi.fn() }));
vi.mock("../lib/firebase", () => ({ signOutToGuest: vi.fn() }));
vi.mock("../lib/signIn", () => ({ signInWithGoogle: vi.fn(), completeSignIn: vi.fn() }));

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
});
