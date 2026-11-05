import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Menu } from "./Menu";
import { useModal } from "./useModal";

function Sheet({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose);
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label="Settings">
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Menu label="More" button="⋮">
        <li>
          <button type="button" className="menu__action" onClick={() => setOpen(true)}>
            Settings
          </button>
        </li>
        <li>
          <button type="button" className="menu__action">
            Rename
          </button>
        </li>
      </Menu>
      <button type="button">Next on the page</button>
      {open && <Sheet onClose={() => setOpen(false)} />}
    </>
  );
}

const details = () => document.querySelector("details")!;

describe("Menu", () => {
  it("hands the focus back to its button when a dialog opened from it closes", async () => {
    render(<Page />);
    screen.getByLabelText("More").focus();
    // jsdom does not open a <details> from its summary; the browser does.
    details().open = true;
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(details().open).toBe(false);
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("More")).toHaveFocus();
  });

  it("closes when Tab takes the focus past its last item", async () => {
    render(<Page />);
    screen.getByLabelText("More").focus();
    // jsdom does not open a <details> from its summary; the browser does.
    details().open = true;
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Rename", hidden: true })).toHaveFocus();
    expect(details().open).toBe(true);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Next on the page" })).toHaveFocus();
    expect(details().open).toBe(false);
  });

  it("stays open when a click, not Tab, moves the focus off it, as Safari's do", () => {
    render(<Page />);
    details().open = true;
    // Safari focuses nothing on a press; the focus leaves the summary for the page.
    fireEvent.blur(screen.getByLabelText("More"), {
      relatedTarget: screen.getByRole("button", { name: "Next on the page" }),
    });
    expect(details().open).toBe(true);
  });
});
