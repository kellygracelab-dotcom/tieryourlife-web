import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SiteSnackbar,
  Snackbar,
  SNACKBAR_BOARD_MS,
  SNACKBAR_LONG_MS,
  SNACKBAR_MS,
  useBoardNotice,
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
    // The focus it took itself holds nothing; moved there by the person, it does.
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
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

  // Friends, 16.11: "Deleted: LOV66 · Undo" stayed on and on. The Undo had taken
  // the focus the press left behind, and a focused notice waited for good.
  it("goes in its time though its Undo took the focus the press left", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(<Snackbar notice={null} onDone={onDone} />);
    rerender(<Snackbar notice={undoable} onDone={onDone} />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    act(() => vi.advanceTimersByTime(SNACKBAR_MS));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stays four seconds on a board, and a long notice there its ten", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(
      <Snackbar notice={{ text: "Card trashed" }} onDone={onDone} onBoard />,
    );
    act(() => vi.advanceTimersByTime(SNACKBAR_BOARD_MS - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledOnce();

    rerender(<Snackbar notice={{ ...undoable, long: true }} onDone={onDone} onBoard />);
    act(() => vi.advanceTimersByTime(SNACKBAR_LONG_MS - 1));
    expect(onDone).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("closes at its cross", () => {
    const onDone = vi.fn();
    const undo = vi.fn();
    render(
      <Snackbar
        notice={{ text: "Card trashed", action: { text: "Undo", onClick: undo } }}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });

  it("goes when pushed aside far enough, and comes back from a short push or a scroll", () => {
    const onDone = vi.fn();
    render(<Snackbar notice={undoable} onDone={onDone} />);
    const notice = screen.getByText("1 list deleted").parentElement!;
    const push = (dx: number, dy = 0) => {
      fireEvent.pointerDown(notice, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(notice, { pointerId: 1, clientX: 100 + dx / 2, clientY: 100 + dy / 2 });
      fireEvent.pointerMove(notice, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
      fireEvent.pointerUp(notice, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
    };
    push(40);
    push(10, 120);
    expect(onDone).not.toHaveBeenCalled();
    expect(notice).not.toHaveClass("snackbar--swiped");
    push(-120);
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe("a board's notice", () => {
  const card = { text: "Card trashed", action: { text: "Undo", onClick: () => undefined } };

  it("is replaced by the next, and gone at the next change to the board", () => {
    const { result } = renderHook(() => useBoardNotice());
    act(() => result.current.setNotice(card));
    act(() => {
      result.current.acted();
      result.current.setNotice({ text: "Tier removed" });
    });
    expect(result.current.notice).toEqual({ text: "Tier removed" });
    act(() => result.current.acted());
    expect(result.current.notice).toBeNull();
  });

  it("is gone at a press on a board's card or control, not on its bare ground", () => {
    const { result } = renderHook(() => useBoardNotice());
    const board = document.body.appendChild(document.createElement("div"));
    board.className = "ranking";
    const ground = board.appendChild(document.createElement("div"));
    const tile = board.appendChild(document.createElement("div"));
    tile.dataset.item = "3";
    const picture = tile.appendChild(document.createElement("img"));
    const elsewhere = document.body.appendChild(document.createElement("button"));
    act(() => result.current.setNotice(card));
    fireEvent.pointerDown(ground);
    fireEvent.pointerDown(elsewhere);
    expect(result.current.notice).toBe(card);
    fireEvent.pointerDown(picture);
    expect(result.current.notice).toBeNull();
    board.remove();
    elsewhere.remove();
  });

  it("keeps a long one, the only way back, through the board's next action", () => {
    const { result } = renderHook(() => useBoardNotice());
    const long = { ...card, long: true };
    act(() => result.current.setNotice(long));
    act(() => result.current.acted());
    expect(result.current.notice).toBe(long);
  });
});
