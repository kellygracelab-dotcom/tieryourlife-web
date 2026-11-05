import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function Opener({ busy = false, onConfirm = vi.fn() }: { busy?: boolean; onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete…
      </button>
      {open && (
        <ConfirmDialog
          title="Delete this list?"
          body="Its link stops working."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          cancelLabel="Keep it"
          busy={busy}
          trouble={<p role="alert">No connection</p>}
          onConfirm={onConfirm}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("is named by its title and puts the focus on the safe button", async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this list?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Its link stops working.");
    expect(screen.getByRole("alert")).toHaveTextContent("No connection");
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
  });

  it("keeps Tab inside, and gives the focus back to the opener on close", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Delete…" });
    await userEvent.click(opener);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on a click beside it, not on a click inside", async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByText("Its link stops working."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const scrim = screen.getByRole("dialog").parentElement;
    if (scrim === null) throw new Error("no scrim");
    await userEvent.click(scrim);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirms, and while the action is under way nothing dismisses it", async () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<Opener onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(<Opener busy onConfirm={onConfirm} />);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    const scrim = screen.getByRole("dialog").parentElement;
    if (scrim === null) throw new Error("no scrim");
    await userEvent.click(scrim);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("gives the focus back to the pressed button when the action failed and the dialog stays", async () => {
    const { rerender } = render(<Opener />);
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.tab();
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm).toHaveFocus();
    // A browser drops the focus of a button greyed out under it; jsdom keeps it.
    confirm.blur();
    rerender(<Opener busy />);
    expect(document.body).toHaveFocus();
    rerender(<Opener />);
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
  });

  it("leaves the focus where the person put it while the action was under way", async () => {
    const { rerender } = render(<Opener />);
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.tab();
    rerender(<Opener busy />);
    screen.getByRole("button", { name: "Delete…" }).focus();
    rerender(<Opener />);
    expect(screen.getByRole("button", { name: "Delete…" })).toHaveFocus();
  });
});
