import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addToPool, liveItems, moveItem, newBoard, rankedTiers, type Board } from "./model";
import { hookLine, ShareButton } from "./ShareButton";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

/** Four games in S, one in A. */
const games = (): Board => {
  const next = uids();
  let board = addToPool(
    newBoard("b", "Games", 1, next),
    ["Baldur's Gate 3", "The Witcher 3", "Elden Ring", "Portal 2", "Doom"].map((title) => ({
      title,
      imageUrl: null,
    })),
    1,
    next,
  );
  const [s, a] = rankedTiers(board);
  liveItems(board).forEach((item, n) => {
    board = moveItem(board, item.uid, n < 4 ? s!.uid : a!.uid, 99, 2);
  });
  return board;
};

describe("hookLine", () => {
  it("names the top tier's first three cards and asks", () => {
    expect(hookLine(games())).toBe(
      "My S tier: Baldur's Gate 3, The Witcher 3, Elden Ring. What’s yours?",
    );
  });

  it("asks alone when nothing is placed", () => {
    expect(hookLine(newBoard("b", "Empty", 1, uids()))).toBe("What’s yours?");
  });
});

describe("ShareButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const show = () => {
    const onShareImage = vi.fn();
    const onSettings = vi.fn();
    render(
      <MemoryRouter>
        <ShareButton
          board={games()}
          listId="L1"
          filled
          onShareImage={onShareImage}
          onSettings={onSettings}
        />
      </MemoryRouter>,
    );
    return { onShareImage, onSettings };
  };

  it("copies the link at once on a computer, and its card offers the rest", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { onSettings } = show();
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/l\/L1$/));
    const card = await screen.findByRole("dialog", { name: "Share" });
    expect(card).toHaveTextContent("Link copied");
    const address = screen.getByRole<HTMLInputElement>("textbox", { name: "The list’s address" });
    expect(address.value).toMatch(/\/l\/L1$/);
    expect(screen.getByRole("link", { name: "Open in Community" })).toHaveAttribute(
      "href",
      "/l/L1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Publishing settings" }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByRole("dialog", { name: "Share" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the phone's share sheet with the hook line and the link", async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, share });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        text: "My S tier: Baldur's Gate 3, The Witcher 3, Elden Ring. What’s yours?",
        url: expect.stringMatching(/\/l\/L1$/),
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
