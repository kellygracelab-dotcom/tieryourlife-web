import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../../lib/storage";
import type { SnackbarNotice } from "../../ui/Snackbar";
import type { PlayCard, PlayTier } from "./board";

// A chunk as the network brings it: held back, or not at all (and no reload).
const chunk = vi.hoisted(() => ({ fail: false, held: null as Promise<void> | null, loads: 0 }));
vi.mock("../../lib/freshChunk", () => ({
  freshChunk:
    <T,>(load: () => Promise<T>) =>
    async () => {
      chunk.loads++;
      if (chunk.fail) throw new Error("the chunk did not come");
      await chunk.held;
      return load();
    },
}));

const CARDS: PlayCard[] = ["Alien", "Heat", "Up"].map((name, i) => ({
  id: `c${i}`,
  name,
  imageUrl: null,
}));
const TIERS: PlayTier[] = ["s", "a"].map((id) => ({
  id,
  label: id.toUpperCase(),
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds: [],
}));

/** A page with Play, from a fresh copy of the module: nothing of Play's screens fetched yet. */
async function renderPage(notify: (notice: SnackbarNotice) => void = () => undefined) {
  const { usePlay } = await import("./usePlay");
  const { PlayButton } = await import("./PlayButton");
  function Page() {
    const play = usePlay("b1", CARDS, TIERS, memoryStore(), {
      title: "Films",
      onApply: () => undefined,
      notify,
    });
    return (
      <>
        <PlayButton {...play.button} />
        {play.playing && <p>playing</p>}
        {play.view}
      </>
    );
  }
  render(<Page />);
  return screen.getByRole("button", { name: "Play" });
}

beforeEach(() => {
  vi.resetModules();
  chunk.fail = false;
  chunk.held = null;
  chunk.loads = 0;
});

describe("Play's screens", () => {
  it("are fetched the first time Play opens, the button keeping the focus meanwhile", async () => {
    let release = () => undefined as void;
    chunk.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const play = await renderPage();

    await userEvent.click(play);
    expect(screen.getByText("playing")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(play).toHaveFocus();

    release();
    expect(await screen.findByText("3 cards from Films")).toBeInTheDocument();
  });

  it("close Play and say so when they will not come, and come on the next press", async () => {
    chunk.fail = true;
    const notify = vi.fn();
    const play = await renderPage(notify);

    await userEvent.click(play);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        text: "Play could not open. Check the connection and try again.",
      }),
    );
    expect(screen.queryByText("playing")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    chunk.fail = false;
    await userEvent.click(play);
    expect(await screen.findByText("3 cards from Films")).toBeInTheDocument();
  });

  it("are fetched once, and a second opening shows them at once", async () => {
    const play = await renderPage();
    await userEvent.click(play);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("playing")).not.toBeInTheDocument());

    await userEvent.click(play);
    expect(screen.getByText("3 cards from Films")).toBeInTheDocument();
    expect(chunk.loads).toBe(1);
  });
});
