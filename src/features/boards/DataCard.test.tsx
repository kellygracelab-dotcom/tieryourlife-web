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

  it("answers a press of Back up now at once", async () => {
    const sync = show({ status: "stuck", lastSyncedAt: NOW - 60_000 });
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Not backed up since");
  });
});
