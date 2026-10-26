import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useModal } from "./useModal";

function Dialog({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose, initial);
  return (
    <div ref={box} role="dialog" aria-label="Test">
      <button type="button">First</button>
      <button type="button" disabled>
        Off
      </button>
      <a href="/middle">Middle</a>
      <button type="button" className="last">
        Last
      </button>
    </div>
  );
}

function Host({ initial }: { initial?: string }) {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Outside</button>
      <p>closed {closes}</p>
      {open && (
        <Dialog
          // A new function every render: the focus must not jump because of it.
          onClose={() => {
            setCloses((n) => n + 1);
            setOpen(false);
          }}
          initial={initial}
        />
      )}
    </>
  );
}

describe("useModal", () => {
  it("moves the focus in, keeps Tab inside both ways, and hands it back on Escape", async () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

    // Every stop is taken in order, the disabled one skipped, and round again.
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Middle" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("closed 1")).toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("starts on the control asked for, and brings a focus that wandered off back in", async () => {
    render(<Host initial=".last" />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    screen.getByRole("button", { name: "Outside" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("calls the latest close without moving the focus when it changes", async () => {
    const first = vi.fn();
    const second = vi.fn();
    function Changing() {
      const [which, setWhich] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setWhich(1)}>
            Swap
          </button>
          <Dialog onClose={which === 0 ? first : second} />
        </>
      );
    }
    render(<Changing />);
    const inside = screen.getByRole("button", { name: "First" });
    expect(inside).toHaveFocus();
    // Swapping from outside: the dialog's focus is not reset by the change.
    screen.getByRole("button", { name: "Last" }).focus();
    screen.getByRole("button", { name: "Swap" }).click();
    await userEvent.keyboard("{Escape}");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
