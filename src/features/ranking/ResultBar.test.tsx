import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ResultBar, type FinishState } from "./ResultBar";

const show = (finish: FinishState, copy = vi.fn(async () => undefined)) => {
  const onRetry = vi.fn();
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <ResultBar finish={finish} onRetry={onRetry} onChange={onChange} copy={copy} />
    </MemoryRouter>,
  );
  return { onRetry, onChange, copy };
};

describe("ResultBar", () => {
  it("is nothing before Finish and a status while saving", () => {
    const { container } = render(
      <MemoryRouter>
        <ResultBar finish={{ status: "idle" }} onRetry={() => {}} onChange={() => {}} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    show({ status: "saving" });
    expect(screen.getByRole("status")).toHaveTextContent("Saving your ranking…");
  });

  it("states the link, copies it as https and offers the page and a change of mind", async () => {
    const { copy, onChange } = show({ status: "done", code: "abcdefgh" });
    const address = `${window.location.host}/r/abcdefgh`;
    expect(screen.getByRole("status")).toHaveTextContent(`Your ranking is live at ${address}`);
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/r/abcdefgh");

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(copy).toHaveBeenCalledWith(`https://${address}`);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change ranking" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("goes back to Copy link after a moment, and stays on it when copying fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { copy } = show({ status: "done", code: "abcdefgh" });
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(copy).toHaveBeenCalled();
    await screen.findByRole("button", { name: "Copied" });
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    vi.useRealTimers();

    const failing = vi.fn(async () => {
      throw new Error("no clipboard");
    });
    show({ status: "done", code: "zzzzzzzz" }, failing);
    await userEvent.click(screen.getAllByRole("button", { name: "Copy link" })[1]!);
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("names a failure and lets a person try again, except when the list is gone", async () => {
    const { onRetry } = show({ status: "failed", error: { kind: "offline" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    show({ status: "failed", error: { kind: "unknown", status: 500 } });
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("Could not save");

    show({ status: "failed", error: { kind: "notFound" } });
    expect(screen.getAllByRole("alert")[2]).toHaveTextContent("isn’t available anymore");
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2);
  });
});
