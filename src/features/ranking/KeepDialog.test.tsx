import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeepDialog, type KeepState } from "./KeepDialog";

const show = (state: KeepState) => {
  const onGoogle = vi.fn();
  const onLinkOnly = vi.fn();
  render(<KeepDialog state={state} onGoogle={onGoogle} onLinkOnly={onLinkOnly} />);
  return { onGoogle, onLinkOnly };
};

describe("KeepDialog", () => {
  it("is nothing while closed", () => {
    show("closed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Google first and the link alone as a real exit", async () => {
    const { onGoogle, onLinkOnly } = show("open");
    expect(screen.getByRole("dialog", { name: "Keep this ranking" })).toBeInTheDocument();
    expect(screen.getByText(/The link works either way/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(onGoogle).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep the link only" }));
    expect(onLinkOnly).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on the scrim, not on the card", async () => {
    const { onLinkOnly } = show("open");
    await userEvent.keyboard("{Escape}");
    expect(onLinkOnly).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("dialog"));
    expect(onLinkOnly).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onLinkOnly).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside, and gives the focus back when it closes", async () => {
    const onLinkOnly = vi.fn();
    const at = (state: KeepState) => (
      <>
        <button type="button">Finish</button>
        <a href="/privacy.html">Privacy policy</a>
        <KeepDialog state={state} onGoogle={vi.fn()} onLinkOnly={onLinkOnly} />
      </>
    );
    const { rerender } = render(at("closed"));
    screen.getByRole("button", { name: "Finish" }).focus();
    rerender(at("open"));
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Keep the link only" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveFocus();

    // A failed sign-in gives back the button it took away.
    rerender(at("busy"));
    rerender(at("failed"));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveFocus();

    rerender(at("closed"));
    expect(screen.getByRole("button", { name: "Finish" })).toHaveFocus();
  });

  it("waits while the sign-in is under way and names a failure", () => {
    show("busy");
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    show("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not sign in");
  });
});
