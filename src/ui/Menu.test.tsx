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

  it("moves an open list back inside the window from either edge", () => {
    render(<Page />);
    const list = document.querySelector<HTMLElement>(".menu__list")!;
    // A phone's window: jsdom lays nothing out and has no width of its own.
    const width = 360;
    Object.defineProperty(document.documentElement, "clientWidth", {
      value: width,
      configurable: true,
    });
    const at = (left: number) => {
      list.getBoundingClientRect = () => ({ left, right: left + 240 }) as DOMRect;
      details().open = true;
      fireEvent(details(), new Event("toggle"));
      return list.style.getPropertyValue("--menu-shift");
    };

    // A ⋮ near the start of a phone's window hung its list past the left edge,
    // and one in a right-to-left page past the right edge.
    expect(at(-76)).toBe("84px");
    details().open = false;
    expect(at(width - 200)).toBe("-48px");
    details().open = false;
    expect(at(100)).toBe("");
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });

  // QA W45: the shift was measured only when the menu opened, and a stale one
  // pushed the list out when the window narrowed or the phone was turned.
  it("moves an open list back inside when the window changes size or turns", () => {
    render(<Page />);
    const list = document.querySelector<HTMLElement>(".menu__list")!;
    const windowOf = (width: number) =>
      Object.defineProperty(document.documentElement, "clientWidth", {
        value: width,
        configurable: true,
      });
    let left = 968;
    list.getBoundingClientRect = () => ({ left, right: left + 240 }) as DOMRect;
    windowOf(1240);
    details().open = true;
    fireEvent(details(), new Event("toggle"));
    expect(list.style.getPropertyValue("--menu-shift")).toBe("");

    windowOf(960);
    fireEvent(window, new Event("resize"));
    expect(list.style.getPropertyValue("--menu-shift")).toBe("-256px");

    // Turned upright: the button is elsewhere now, and the old shift goes.
    left = 100;
    windowOf(414);
    fireEvent(window, new Event("orientationchange"));
    expect(list.style.getPropertyValue("--menu-shift")).toBe("");

    // A closed menu is left alone.
    details().open = false;
    left = -50;
    fireEvent(window, new Event("resize"));
    expect(list.style.getPropertyValue("--menu-shift")).toBe("");
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });
});
