import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { emptyStatistics, type Statistics, type StatsQuery } from "../../api/admin";
import { StatisticsPane } from "./StatisticsPane";

vi.mock("../../lib/api", async () => ({
  ...(await import("../../test/apiMock")).apiStubs(),
  loadSearchMisses: vi.fn(async () => [{ q: "soulslikes", count: 4, lastAt: 0 }]),
}));

const NOON = Date.UTC(2026, 10, 20, 12);

const counted = (query: StatsQuery): Statistics => ({
  ...emptyStatistics(query),
  period: { from: query.from, to: query.to, partialToday: true },
  updatedAt: NOON,
  tiles: {
    mau: 2340,
    dauAverage: 410,
    newUsers: 1120,
    d7: 0.18,
    published: 64,
    crashFreeUsers: 0.996,
  },
  previous: {
    mau: 2090,
    dauAverage: 380,
    newUsers: 930,
    d7: 0.2,
    published: 59,
    crashFreeUsers: 0.995,
  },
  daily: [
    {
      date: "2026-11-19",
      active: { android: 300, web: 90 },
      newUsers: { android: 40, web: 10 },
      crashes: { android: 1, web: 0 },
    },
    {
      date: "2026-11-20",
      active: { android: 320, web: 100 },
      newUsers: { android: 45, web: 12 },
      crashes: { android: 0, web: 2 },
    },
  ],
  funnel: [
    { step: "firstOpen", count: 1120 },
    { step: "firstBoard", count: 640 },
    { step: "published", count: 40 },
  ],
  retention: [{ week: "2026-W47", size: 310, d1: 0.34, d7: null, d30: null }],
  pictureSearches: {
    top: [
      { q: "dogs", section: "animals", count: 12 },
      { q: "consoles", section: "games", count: 30 },
    ],
    empty: [],
  },
  lists: [{ id: "L1", title: "Every game console", opens: 90, copies: 12, finished: 7, shared: 3 }],
  crashes: {
    freeUsers: 0.996,
    freeSessions: 0.999,
    top: [
      {
        platform: "web",
        type: "TypeError",
        place: "board.js:12",
        version: "w1",
        count: 2,
        people: 2,
        firstAt: NOON,
        lastAt: NOON,
      },
      {
        platform: "android",
        type: "IllegalStateException",
        place: "Board.save",
        version: "1.4",
        count: 1,
        people: 1,
        firstAt: NOON,
        lastAt: NOON,
      },
    ],
  },
});

function open(load: (query: StatsQuery) => Promise<Statistics>) {
  const router = createMemoryRouter(
    [{ path: "/admin/statistics", element: <StatisticsPane load={load} now={() => NOON} /> }],
    { initialEntries: ["/admin/statistics"] },
  );
  render(<RouterProvider router={router} />);
}

describe("StatisticsPane", () => {
  it("asks for the last 30 days of both platforms, and shows the six figures against the period before", async () => {
    const load = vi.fn(async (query: StatsQuery) => counted(query));
    open(load);
    expect(load).toHaveBeenCalledWith({ from: "2026-10-22", to: "2026-11-20", platform: "all" });
    const tiles = await screen.findAllByRole("listitem");
    const mau = tiles.find((tile) => tile.textContent?.startsWith("MAU"))!;
    expect(mau).toHaveTextContent("2,340");
    expect(mau).toHaveTextContent("+12%");
    const d7 = tiles.find((tile) => tile.textContent?.startsWith("D7"))!;
    expect(d7).toHaveTextContent("18%");
    expect(d7).toHaveTextContent("-2 p.p.");
    expect(
      screen.getByText("Today isn’t over yet: its numbers are still growing."),
    ).toBeInTheDocument();
  });

  it("asks again for another period and platform, and drops the comparison when asked", async () => {
    const load = vi.fn(async (query: StatsQuery) => counted(query));
    open(load);
    await screen.findByText("2,340");
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(load).toHaveBeenLastCalledWith({
      from: "2026-11-14",
      to: "2026-11-20",
      platform: "all",
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Platform" }), "web");
    expect(load).toHaveBeenLastCalledWith({
      from: "2026-11-14",
      to: "2026-11-20",
      platform: "web",
    });
    await screen.findByText("2,340");
    await userEvent.click(screen.getByRole("checkbox", { name: "Compare with the period before" }));
    expect(screen.queryByText("+12%")).toBeNull();
    // Only the site's errors on the site's platform.
    const errors = screen.getByRole("heading", { name: "Top errors" }).closest(".stats-table")!;
    expect(errors).toHaveTextContent("TypeError");
    expect(errors).not.toHaveTextContent("IllegalStateException");
  });

  it("asks nothing for a custom period until both dates are in", async () => {
    const load = vi.fn(async (query: StatsQuery) => counted(query));
    open(load);
    await screen.findByText("2,340");
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    const calls = load.mock.calls.length;
    await userEvent.type(screen.getByLabelText("From"), "2026-11-01");
    expect(load).toHaveBeenCalledTimes(calls);
    await userEvent.type(screen.getByLabelText("To"), "2026-11-05");
    expect(load).toHaveBeenLastCalledWith({
      from: "2026-11-01",
      to: "2026-11-05",
      platform: "all",
    });
  });

  it("draws the funnel with each step's share of the one before", async () => {
    open(async (query) => counted(query));
    const funnel = (await screen.findByText("First open")).closest("ol")!;
    const steps = within(funnel).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "First open1,120",
      "First list64057.1% of the step before",
      "Published406.3% of the step before",
    ]);
  });

  it("sorts a table by a column, and links a list to its page", async () => {
    open(async (query) => counted(query));
    const table = (await screen.findByRole("heading", { name: "Picture searches" })).closest(
      ".stats-table",
    )! as HTMLElement;
    const firstCells = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(firstCells()).toEqual(["consoles", "dogs"]);
    await userEvent.click(within(table).getByRole("button", { name: "Sort by Search" }));
    expect(firstCells()).toEqual(["consoles", "dogs"]);
    await userEvent.click(within(table).getByRole("button", { name: "Sort by Times" }));
    expect(firstCells()).toEqual(["consoles", "dogs"]);
    await userEvent.click(within(table).getByRole("button", { name: "Sort by Times" }));
    expect(firstCells()).toEqual(["dogs", "consoles"]);
    expect(screen.getByRole("link", { name: "Every game console" })).toHaveAttribute(
      "href",
      "/l/L1",
    );
  });

  it("says what is not counted yet instead of a number, and keeps the empty searches", async () => {
    open(async (query) => emptyStatistics(query));
    expect(
      await screen.findByText(
        "Nothing is counted yet. The numbers appear here once the server starts counting them.",
      ),
    ).toBeInTheDocument();
    const mau = screen
      .getAllByRole("listitem")
      .find((tile) => tile.textContent?.startsWith("MAU"))!;
    expect(mau).toHaveTextContent("—");
    expect(await screen.findByText("soulslikes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Searches with no results" })).toBeInTheDocument();
  });

  it("turns the crash-free tile red below 99.5%", async () => {
    open(async (query) => ({
      ...counted(query),
      tiles: { ...counted(query).tiles, crashFreeUsers: 0.99 },
    }));
    const tile = (await screen.findByText("Crash-free")).closest("li")!;
    expect(tile).toHaveClass("stats-tile--alarm");
  });

  it("offers another try when the statistics did not come", async () => {
    const load = vi
      .fn<(query: StatsQuery) => Promise<Statistics>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (query) => counted(query));
    open(load);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2,340")).toBeInTheDocument();
  });
});
