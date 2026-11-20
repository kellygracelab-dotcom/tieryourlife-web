import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./signedIn";

const tile = (value: number, previous: number) => ({
  value,
  previous,
  change: (value - previous) / previous,
});

const day = (date: string, android: number, web: number) => ({
  day: date,
  active: android + web,
  "active.android": android,
  "active.web": web,
  "step.first_launch": Math.round((android + web) / 8),
  sessions: (android + web) * 2,
  "sessions.crashed": android % 3,
});

/** The backend's answer as CONTRACT.md (Usage statistics) writes it. */
const STATISTICS = {
  period: { from: "2026-10-22", to: "2026-11-20", days: 30, todayIsPartial: true, platform: "all" },
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
  daily: Array.from({ length: 30 }, (_, index) =>
    day(
      `2026-${index < 10 ? "10" : "11"}-${String(index < 10 ? 22 + index : index - 9).padStart(2, "0")}`,
      250 + index * 4,
      60 + index * 2,
    ),
  ),
  totals: {
    "search.pictures": 820,
    "search.pictures.miss": 40,
    "search.lists": 140,
    "search.lists.miss": 12,
    "server.5xx": 3,
    "server.appCheckRefused": 12,
    "server.sourceBusy": 1,
    "f.game": 190,
    "f.share_image": 120,
  },
  funnel: [
    { step: "first_launch", n: 1120 },
    { step: "open_list", n: 900 },
    { step: "first_board", n: 640 },
    { step: "first_card", n: 600 },
    { step: "full_list", n: 380 },
    { step: "first_game", n: 190 },
    { step: "shared", n: 120 },
    { step: "signed_in", n: 150 },
    { step: "published", n: 40 },
  ],
  retention: [
    { week: "2026-W47", size: 310, d1: 0.34, d7: 0.19, d30: null },
    { week: "2026-W46", size: 280, d1: 0.31, d7: 0.17, d30: 0.09 },
  ],
  rolling: { asOf: "2026-11-20", dau: 420, wau: 1500, mau: 2340 },
  audience: {
    versions: [{ value: "1.4.0 (140)", n: 1800 }],
    languages: [
      { value: "en", n: 1200 },
      { value: "ru", n: 400 },
    ],
    regions: [
      { value: "US", n: 700 },
      { value: "UA", n: 300 },
    ],
    accounts: {
      asOf: "2026-11-20T03:00:00Z",
      complete: true,
      guests: { total: 1500, new1: 40, active1: 120, active7: 600, active30: 1100 },
      google: { total: 840, new1: 9, active1: 70, active7: 300, active30: 640 },
    },
  },
  top: {
    lists: [{ id: "L1", title: "Every game console", views: 90, takes: 12 }],
    topics: [{ id: "t1", name: "Pizza", opens: 40, follows: 6 }],
    sections: [{ id: "food", opens: 120 }],
    pictureSearch: [
      { q: "game consoles of the nineties", section: "games", n: 30, miss: 0 },
      { q: "dogs", section: "animals", n: 12, miss: 1 },
    ],
    pictureMisses: [{ q: "obscure band name", section: "music", n: 4, miss: 4 }],
    listSearch: [{ q: "anime", section: null, n: 18, miss: 0 }],
    listMisses: [],
    crashes: [
      {
        type: "IllegalStateException",
        place: "com.tieryourlife.board.BoardViewModel.save",
        version: "1.4.0",
        n: 7,
        first: "2026-11-18",
        last: "2026-11-20",
      },
    ],
    referrers: [
      { domain: "reddit.com", utm: null, n: 50 },
      { domain: "", utm: null, n: 400 },
    ],
  },
  links: { crashlytics: null, playConsole: null, searchConsole: null },
};

async function openStatistics(page: Page) {
  await signIn(page);
  await page.route(
    (url) => url.pathname.endsWith("/lists/sections"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sections: [], role: "owner", version: 1 }),
      }),
  );
  await page.route(
    (url) => url.pathname.endsWith("/lists/admin/stats"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(STATISTICS),
      }),
  );
  await page.route(
    (url) => url.pathname.endsWith("/lists/search-misses"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ misses: [{ q: "soulslikes", count: 4, lastAt: Date.now() }] }),
      }),
  );
  await page.goto("/admin/statistics");
  await expect(page.getByRole("heading", { level: 2, name: "Statistics" })).toBeVisible();
  await expect(page.locator(".stats-tile").first()).toContainText("2,340");
}

test("Statistics fits the window: its tables scroll inside, the page never sideways", async ({
  page,
}, testInfo) => {
  await openStatistics(page);
  await expect(page.getByText("soulslikes")).toBeVisible();
  await expect(page.getByRole("table", { name: "Accounts on 2026-11-20" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("statistics.png"), fullPage: true });
});
