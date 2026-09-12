import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PLAY_URL } from "../../lib/links";
import { ResultBar, type FinishState } from "./ResultBar";

const show = (
  finish: FinishState,
  copy = vi.fn(async () => undefined),
  download: (address: string) => Promise<void> = vi.fn(async () => undefined),
) => {
  const onRetry = vi.fn();
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <ResultBar
        finish={finish}
        onRetry={onRetry}
        onChange={onChange}
        copy={copy}
        download={download}
      />
    </MemoryRouter>,
  );
  return { onRetry, onChange, copy, download };
};

describe("ResultBar", () => {
  it("is nothing before Finish and a status while saving", () => {
    const { container } = render(
      <MemoryRouter>
        <ResultBar
          finish={{ status: "idle" }}
          onRetry={() => {}}
          onChange={() => {}}
          download={async () => {}}
        />
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

  it("makes the image on request, says so meanwhile, and names a failure", async () => {
    let settle: () => void = () => {};
    const download = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    show({ status: "done", code: "abcdefgh" }, undefined, download);
    await userEvent.click(screen.getByRole("button", { name: "Download image" }));
    expect(download).toHaveBeenCalledWith(`${window.location.host}/r/abcdefgh`);
    expect(screen.getByRole("button", { name: "Making the image…" })).toBeDisabled();
    await act(async () => settle());
    expect(screen.getByRole("button", { name: "Download image" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();

    const failing = vi.fn(async () => {
      throw new Error("no canvas");
    });
    show({ status: "done", code: "zzzzzzzz" }, undefined, failing);
    await userEvent.click(screen.getAllByRole("button", { name: "Download image" })[1]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not make the image");
  });

  it("mentions the app only once the link is copied or the image is made", async () => {
    const invite = () => screen.queryAllByRole("link", { name: "Keep your lists on your phone" });
    show({ status: "done", code: "abcdefgh" });
    expect(invite()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(invite()).toHaveLength(1);
    expect(invite()[0]).toHaveAttribute("href", PLAY_URL);
    expect(invite()[0]).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/Flip cover/)).toBeInTheDocument();

    show({ status: "done", code: "zzzzzzzz" });
    expect(invite()).toHaveLength(1);
    await userEvent.click(screen.getAllByRole("button", { name: "Download image" })[1]!);
    expect(
      await screen.findAllByRole("link", { name: "Keep your lists on your phone" }),
    ).toHaveLength(2);

    const failing = vi.fn(async () => {
      throw new Error("no clipboard");
    });
    show({ status: "done", code: "yyyyyyyy" }, failing);
    await userEvent.click(screen.getAllByRole("button", { name: "Copy link" })[2]!);
    expect(invite()).toHaveLength(2);
  });

  it("names a failure and lets a person try again, except when the list is gone", async () => {
    const { onRetry } = show({ status: "failed", error: { kind: "offline" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    show({ status: "failed", error: { kind: "unavailable" } });
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("Could not save");

    show({ status: "failed", error: { kind: "notFound" } });
    expect(screen.getAllByRole("alert")[2]).toHaveTextContent("isn’t available anymore");
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2);
  });
});
