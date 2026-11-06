import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { BoardSyncContext, type BoardSyncControls } from "./boardSync";
import { DataCard, STUCK_AFTER_MS } from "./DataCard";

const NOW = 1_800_000_000_000;

const show = (sync: Partial<BoardSyncControls>) => {
  const value: BoardSyncControls = {
    signedIn: true,
    backUp: true,
    setBackUp: () => Promise.resolve(),
    status: "idle",
    lastSyncedAt: null,
    refusals: [],
    syncNow: vi.fn(() => Promise.resolve()),
    ...sync,
  };
  render(
    <BoardSyncContext.Provider value={value}>
      <MemoryRouter>
        <DataCard now={() => NOW} />
      </MemoryRouter>
    </BoardSyncContext.Provider>,
  );
  return value;
};

describe("DataCard: a back-up that did not go through", () => {
  it("says so in words for never, not a dash, and blames nothing", () => {
    show({ status: "stuck", lastSyncedAt: null });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not backed up yet. Back up now to try again.");
    expect(alert).not.toHaveTextContent("—");
    expect(alert).not.toHaveTextContent("connection");
  });

  it("waits a day after the last good run, as the phone does", () => {
    show({ status: "stuck", lastSyncedAt: NOW - STUCK_AFTER_MS + 60_000 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the day of the last good run once a day has gone by", () => {
    show({ status: "stuck", lastSyncedAt: NOW - STUCK_AFTER_MS });
    expect(screen.getByRole("alert")).toHaveTextContent(/^Not backed up since .+\. Back up now/);
  });

  it("names at once a board the account will not keep, and what lets it go up", () => {
    show({
      status: "stuck",
      lastSyncedAt: NOW - 60_000,
      refusals: [
        { uid: "a", title: "Every film", why: "tooLarge" },
        { uid: "b", title: "One too many", why: "tooManyBoards" },
      ],
    });
    const [big, many] = screen.getAllByRole("alert");
    expect(big).toHaveTextContent(
      /^“Every film” is too big for an account to keep.+Take some cards off it/,
    );
    expect(many).toHaveTextContent(
      /^“One too many” is not backed up: an account keeps up to 200 boards./,
    );
    // Trying again would not help, so the page does not ask for it.
    expect(screen.queryByText(/try again/)).toBeNull();
  });

  it("gives the advice that fits the limit: a tier, cards, or the trash", () => {
    show({
      status: "stuck",
      lastSyncedAt: NOW - 60_000,
      refusals: [
        { uid: "a", title: "Twenty rows", why: "tooManyTiers" },
        { uid: "b", title: "Every card", why: "tooManyCards" },
        { uid: "c", title: "Old trash", why: "tooManyTrashed" },
      ],
    });
    const [tiers, cards, trash] = screen.getAllByRole("alert");
    expect(tiers).toHaveTextContent(/^“Twenty rows” has more tiers.+remove a tier/);
    expect(tiers).not.toHaveTextContent(/cards/);
    expect(cards).toHaveTextContent(/^“Every card” has more cards.+take some cards off/);
    expect(trash).toHaveTextContent(/^“Old trash” holds more than 2000 removed cards.+trash/);
  });

  it("answers a press of Back up now at once", async () => {
    const sync = show({ status: "stuck", lastSyncedAt: NOW - 60_000 });
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Not backed up since");
  });
});
