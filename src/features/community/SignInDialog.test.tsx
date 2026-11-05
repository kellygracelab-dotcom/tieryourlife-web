import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SignInDialog } from "./SignInDialog";

function Page({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a href="/">TierYourLife</a>
      <button type="button" onClick={() => setOpen(true)}>
        Follow
      </button>
      <SignInDialog
        open={open}
        busy={busy}
        title="Sign in to follow"
        body="Follow people and see their new lists first."
        onSignIn={vi.fn()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe("SignInDialog", () => {
  it("takes the focus, keeps Tab inside, and gives it back to Follow on Escape and on Cancel", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    const google = screen.getByRole("button", { name: "Continue with Google" });
    expect(google).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.tab();
    expect(google).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Follow" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Follow" })).toHaveFocus();
  });

  it("stays while the sign-in is under way", async () => {
    render(<Page busy />);
    await userEvent.click(screen.getByRole("button", { name: "Follow" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Sign in to follow" })).toBeInTheDocument();
  });
});
