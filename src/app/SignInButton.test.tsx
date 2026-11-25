import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { POPUP_BLOCKED, type SignInOutcome } from "../lib/signIn";
import { GUEST, SessionContext } from "./session";
import { SignInButton } from "./SignInButton";

function press(outcome: SignInOutcome) {
  const signIn = vi.fn(async () => outcome);
  render(
    <SessionContext.Provider
      value={{ account: GUEST, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <SignInButton label="Continue with Google" />
    </SessionContext.Provider>,
  );
  return userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
}

describe("SignInButton", () => {
  // Walkthrough item 17 (Danylo, 25.11): a blocked window says why and the way out.
  it("says the browser blocked Google's window when neither it nor the redirect could open", async () => {
    await press({ kind: "failed", code: POPUP_BLOCKED });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your browser blocked the Google sign-in window");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("says the plain failure for anything else", async () => {
    await press({ kind: "failed", code: "auth/network-request-failed" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in. Try again.");
  });

  it("stays greyed out and quiet while the page leaves for Google", async () => {
    await press({ kind: "redirecting" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  });
});
