import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  emptyStatistics,
  loadStatistics,
  statisticsOf,
  type Statistics,
  type StatsQuery,
} from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import { StatisticsPane } from "./StatisticsPane";

vi.mock("../../lib/api", async () => ({
  ...(await import("../../test/apiMock")).apiStubs(),
  loadSearchMisses: vi.fn(async () => [{ q: "soulslikes", count: 4, lastAt: 0 }]),
}));

const NOON = Date.UTC(2026, 10, 20, 12);

const tile = (value: number, previous: number) => ({
  value,
  previous,
  change: (value - previous) / previous,
});

/** The backend's answer as CONTRACT.md (Usage statistics) writes it. */
const answer = (query: StatsQuery) => ({
  period: { from: query.from, to: query.to, days: 30, todayIsPartial: true, platform: "all" },
  previous: { from: "2026-09-22", to: "2026-10-21" },
  tiles: {
    mau: tile(2340, 2090),
    dauAverage: tile(410, 380),
    newcomers: tile(1120, 930),
    d7: tile(0.18, 0.2),
    published: tile(64, 59),
    crashFreeUsers: tile(0.996, 0.995),
    crashFreeSessions: tile(0.999, 0.998),
  },
  daily: [
    {
      day: "2026-11-19",
      active: 390,
      "active.android": 300,
      "active.web": 90,
      "step.first_launch": 50,
      sessions: 800,
      "sessions.crashed": 1,
    },
    {
      day: "2026-11-20",
      active: 420,
      "active.android": 320,
      "active.web": 100,
      "step.first_launch": 57,
      sessions: 820,
      "sessions.crashed": 2,
    },
  ],
  totals: {
    "search.pictures": 42,
    "search.pictures.miss": 3,
    "server.5xx": 7,
    "f.game": 31,
    "f.share_image": 9,
  },
  funnel: [
    { step: "first_launch", n: 1120 },
    { step: "first_board", n: 640 },
    { step: "published", n: 40 },
    { step: "someday", n: 5 },
  ],
  retention: [{ week: "2026-W47", size: 310, d1: 0.34, d7: null, d30: null }],
  rolling: { asOf: "2026-11-20", dau: 420, wau: 1500, mau: 2340 },
  audience: {
    versions: [{ value: "1.4", n: 300 }],
    languages: [{ value: "ru", n: 200 }],
    regions: [{ value: "UA", n: 150 }],
    accounts: {
      asOf: "2026-11-20T03:00:00Z",
      complete: false,
      guests: { total: 900, new1: 30, active1: 80, active7: 300, active30: 600 },
      google: { total: 400, new1: 5, active1: 40, active7: 120, active30: 250 },
    },
  },
  top: {
    lists: [{ id: "L1", title: "Every game console", views: 90, takes: 12 }],
    topics: [{ id: "T1", name: "Games", opens: 40, follows: 6 }],
    sections: [{ id: "animals", opens: 22 }],
    pictureSearch: [
      { q: "dogs", section: "animals", n: 12, miss: 0 },
      { q: "consoles", section: "games", n: 30, miss: 1 },
    ],
    pictureMisses: [],
    listSearch: [],
    listMisses: [],
    crashes: [
      {
        type: "TypeError",
        place: "board.js:12",
        version: "w1",
        n: 2,
        first: "2026-11-19",
        last: "2026-11-20",
      },
    ],
    referrers: [{ domain: "reddit.com", utm: null, n: 25 }],
  },
  links: {
    crashlytics: "https://example.test/crashlytics",
    playConsole: null,
    searchConsole: null,
  },
});

const counted = (query: StatsQuery): Statistics => statisticsOf(answer(query), query);

function open(load: (query: StatsQuery) => Promise<Statistics>) {
  const router = createMemoryRouter(
    [{ path: "/admin/statistics", element: <StatisticsPane load={load} now={() => NOON} /> }],
    { initialEntries: ["/admin/statistics"] },
  );
  render(<RouterProvider router={router} />);
}

const tileNamed = (name: string) =>
  screen.getAllByRole("listitem").find((one) => one.textContent?.startsWith(name))!;

const tableNamed = (name: string) => screen.getByRole("table", { name });

describe("StatisticsPane", () => {
  it("asks for the last 30 days of both platforms, and shows the figures against the period before", async () => {
    const load = vi.fn(async (query: StatsQuery) => counted(query));
    open(load);
    expect(load).toHaveBeenCalledWith({ from: "2026-10-22", to: "2026-11-20", platform: "all" });
    await screen.findAllByText("2,340");
    expect(tileNamed("MAU")).toHaveTextContent("+12%");
    expect(tileNamed("D7")).toHaveTextContent("18%");
    expect(tileNamed("D7")).toHaveTextContent("-2 p.p.");
    expect(tileNamed("Crash-free")).not.toHaveClass("stats-tile--alarm");
    expect(
      screen.getByText("Today isn’t over yet: its numbers are still growing."),
    ).toBeInTheDocument();
    expect(screen.getByText("DAU on 2026-11-20")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Active by day: 810 in all" })).toBeInTheDocument();
  });

  it("asks again for another period and platform, and drops the comparison when asked", async () => {
    const load = vi.fn(async (query: StatsQuery) => counted(query));
    open(load);
    await screen.findAllByText("2,340");
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
    await screen.findAllByText("2,340");
    await userEvent.click(screen.getByRole("checkbox", { name: "Compare with the period before" }));
    expect(screen.queryByText("+12%")).toBeNull();
  });

  it("asks nothing for a custom period until both dates are in", async () => {
    const load = vi.fn(async (query: StatsQuery) => counted(query));
    open(load);
    await screen.findAllByText("2,340");
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

  it("draws the funnel with each step's share of the one before, skipping steps it does not know", async () => {
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
    await screen.findAllByText("2,340");
    const table = tableNamed("Picture searches");
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

  it("shows the searches' totals, the features the apps use, accounts, audience and the server", async () => {
    open(async (query) => counted(query));
    await screen.findAllByText("2,340");
    const searches = screen.getByRole("region", { name: "Searches" });
    expect(within(searches).getByText("Picture searches", { selector: "dt" })).toBeInTheDocument();
    expect(within(searches).getByText("42")).toBeInTheDocument();
    expect(await within(searches).findByText("soulslikes")).toBeInTheDocument();

    const features = tableNamed("Features");
    expect(within(features).getByText("game")).toBeInTheDocument();
    expect(within(features).getByText("share_image")).toBeInTheDocument();

    const accounts = tableNamed("Accounts on 2026-11-20");
    const guests = within(accounts).getByText("Guests").closest("tr")!;
    expect(
      within(guests)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Guests", "900", "30", "80", "300", "600"]);
    expect(
      screen.getByText("The night’s count stopped early: these numbers are too low."),
    ).toBeInTheDocument();
    expect(within(tableNamed("Languages")).getByText("Russian")).toBeInTheDocument();
    expect(within(tableNamed("Regions")).getByText("Ukraine")).toBeInTheDocument();
    expect(
      within(tableNamed("Where people come from")).getByText("reddit.com"),
    ).toBeInTheDocument();

    const server = screen.getByRole("region", { name: "Server" });
    expect(within(server).getByText("Server errors (5xx)").nextSibling).toHaveTextContent("7");
    expect(within(server).getByText("Accounts deleted").nextSibling).toHaveTextContent("—");

    expect(screen.getByRole("link", { name: "Crashlytics" })).toHaveAttribute(
      "href",
      "https://example.test/crashlytics",
    );
    expect(within(tableNamed("Top errors")).getByText("TypeError")).toBeInTheDocument();
  });

  it("says the apps’ figures need the new app while nothing has come from them", async () => {
    open(async (query) => ({
      ...emptyStatistics(query),
      tiles: { ...emptyStatistics(query).tiles, published: tile(64, 59) },
      compared: true,
    }));
    await screen.findByText("64");
    expect(tileNamed("MAU")).toHaveTextContent("—Needs the new app");
    expect(tileNamed("Crash-free")).toHaveTextContent("—Needs the new app");
    expect(tileNamed("Published")).toHaveTextContent("+8%");
    expect(
      screen.getByText(
        "The apps don’t send their statistics yet: activity, newcomers, retention and crashes appear once they do.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not counted yet: accounts are counted each night."),
    ).toBeInTheDocument();
    // The empty searches the backend kept before stay where they were.
    expect(await screen.findByText("soulslikes")).toBeInTheDocument();
  });

  it("turns the crash-free tile red below 99.5%", async () => {
    open(async (query) => {
      const stats = counted(query);
      return { ...stats, tiles: { ...stats.tiles, crashFreeUsers: tile(0.99, 0.995) } };
    });
    await screen.findAllByText("2,340");
    expect(tileNamed("Crash-free")).toHaveClass("stats-tile--alarm");
  });

  it("offers another try when the statistics did not come", async () => {
    const load = vi
      .fn<(query: StatsQuery) => Promise<Statistics>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (query) => counted(query));
    open(load);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("2,340")).length).toBeGreaterThan(0);
  });
});

describe("loadStatistics", () => {
  const query: StatsQuery = { from: "2026-11-01", to: "2026-11-05", platform: "web" };

  it("asks the backend for the days, the platform and the period before", async () => {
    const request = vi.fn(async () => answer(query));
    const stats = await loadStatistics({ request } as never, query);
    expect(request).toHaveBeenCalledWith("GET", "/lists/admin/stats", {
      query: { from: "2026-11-01", to: "2026-11-05", platform: "web", compare: "1" },
    });
    expect(stats.tiles.mau.value).toBe(2340);
    expect(stats.daily[1]).toEqual({
      day: "2026-11-20",
      active: 420,
      activeAndroid: 320,
      activeWeb: 100,
      newcomers: 57,
      sessions: 820,
      crashedSessions: 2,
    });
    expect(stats.funnel.map((row) => row.step)).toEqual([
      "first_launch",
      "first_board",
      "published",
    ]);
  });

  it("reads a backend without the route as nothing counted, and lets other failures through", async () => {
    const missing = vi.fn(async () => {
      throw new ApiFailure({ kind: "notFound" });
    });
    expect(await loadStatistics({ request: missing } as never, query)).toEqual(
      emptyStatistics(query),
    );
    const refused = vi.fn(async () => {
      throw new ApiFailure({ kind: "notYours" });
    });
    await expect(loadStatistics({ request: refused } as never, query)).rejects.toThrow();
  });

  it("reads a garbled answer as nothing counted", () => {
    const stats = statisticsOf(
      { tiles: { mau: { value: "x" } }, daily: "no", audience: { accounts: 3 } },
      query,
    );
    expect(stats.tiles.mau.value).toBeNull();
    expect(stats.daily).toEqual([]);
    expect(stats.audience.accounts).toBeNull();
    expect(stats.compared).toBe(false);
  });
});
