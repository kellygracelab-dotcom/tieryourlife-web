import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SiteSnackbar,
  Snackbar,
  SNACKBAR_LONG_MS,
  SNACKBAR_MS,
  type SnackbarNotice,
} from "./Snackbar";

const undoable: SnackbarNotice = {
  text: "1 list deleted",
  action: { text: "Undo", onClick: vi.fn() },
};

afterEach(() => vi.useRealTimers());

describe("Snackbar", () => {
  it("has its status region before it has anything to say, so the words are read out", () => {
    const { rerender } = render(<Snackbar notice={null} onDone={vi.fn()} />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    rerender(<Snackbar notice={{ text: "Saved" }} onDone={vi.fn()} />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Saved");
  });

  it("waits while its action has the focus or the pointer, and goes six seconds after", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(
      <>
        <button type="button">Elsewhere</button>
        <Snackbar notice={undoable} onDone={onDone} />
      </>,
    );
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => undo.focus());
    act(() => vi.advanceTimersByTime(SNACKBAR_MS * 2));
    expect(onDone).not.toHaveBeenCalled();

    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    fireEvent.pointerEnter(undo.parentElement!);
    act(() => vi.advanceTimersByTime(SNACKBAR_MS * 2));
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.pointerLeave(undo.parentElement!);
    act(() => vi.advanceTimersByTime(SNACKBAR_MS));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("keeps a long notice for the app's long snackbar, ten seconds", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <Snackbar notice={null} onDone={onDone} />
      </>,
    );
    // The focus has a place, so the notice does not take it and wait.
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <Snackbar notice={{ ...undoable, long: true }} onDone={onDone} />
      </>,
    );
    act(() => vi.advanceTimersByTime(SNACKBAR_MS + 500));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SNACKBAR_LONG_MS - SNACKBAR_MS - 500));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("gives its action the focus when the press that brought it took the focus away", () => {
    const { rerender } = render(<Snackbar notice={null} onDone={vi.fn()} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Snackbar notice={undoable} onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
  });

  it("leaves the focus where it is when it still has a place", () => {
    const { rerender } = render(
      <>
        <button type="button">Star</button>
        <Snackbar notice={null} onDone={vi.fn()} />
      </>,
    );
    screen.getByRole("button", { name: "Star" }).focus();
    rerender(
      <>
        <button type="button">Star</button>
        <Snackbar notice={undoable} onDone={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Star" })).toHaveFocus();
  });

  // QA W42: the shell's notice lay exactly on a page's own and covered its Undo.
  it("stands a second notice above the first, and back down when the first goes", () => {
    const { rerender } = render(
      <>
        <Snackbar notice={undoable} onDone={vi.fn()} />
        <SiteSnackbar notice={{ text: "Couldn't send the report" }} onDone={vi.fn()} />
      </>,
    );
    const page = screen.getByText("1 list deleted").parentElement!;
    const site = screen.getByText("Couldn't send the report").parentElement!;
    const lift = (notice: HTMLElement) =>
      parseFloat(notice.style.getPropertyValue("--snackbar-lift"));
    expect(lift(page)).toBe(0);
    expect(lift(site)).toBeGreaterThan(0);
    rerender(
      <>
        <Snackbar notice={null} onDone={vi.fn()} />
        <SiteSnackbar notice={{ text: "Couldn't send the report" }} onDone={vi.fn()} />
      </>,
    );
    expect(lift(screen.getByText("Couldn't send the report").parentElement!)).toBe(0);
  });

  // QA W48: an inline bottom beat the rules that stand a notice above a board's
  // pool or dock, so the notices covered the cards. The stack only adds a lift.
  it("leaves its place to the stylesheets and only says how much higher to stand", () => {
    render(
      <>
        <Snackbar notice={undoable} onDone={vi.fn()} />
        <SiteSnackbar notice={{ text: "Couldn't send the report" }} onDone={vi.fn()} />
      </>,
    );
    for (const text of ["1 list deleted", "Couldn't send the report"]) {
      const notice = screen.getByText(text).parentElement!;
      expect(notice.style.bottom).toBe("");
      expect(notice.style.getPropertyValue("--snackbar-lift")).toMatch(/^\d+(\.\d+)?px$/);
    }
  });
});
