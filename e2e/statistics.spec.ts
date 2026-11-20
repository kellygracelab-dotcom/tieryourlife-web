import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./signedIn";

const day = (date: string, android: number, web: number) => ({
  date,
  active: { android, web },
  newUsers: { android: Math.round(android / 8), web: Math.round(web / 8) },
  crashes: { android: android % 3, web: web % 2 },
});

const STATISTICS = {
  period: { from: "2026-10-22", to: "2026-11-20", partialToday: true },
  updatedAt: Date.UTC(2026, 10, 20, 11),
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
  daily: Array.from({ length: 30 }, (_, index) =>
    day(
      `2026-${index < 10 ? "10" : "11"}-${String(index < 10 ? 22 + index : index - 9).padStart(2, "0")}`,
      250 + index * 4,
      60 + index * 2,
    ),
  ),
  funnel: [
    { step: "firstOpen", count: 1120 },
    { step: "openedList", count: 900 },
    { step: "firstBoard", count: 640 },
    { step: "firstCard", count: 600 },
    { step: "rankedFive", count: 380 },
    { step: "finishedGame", count: 190 },
    { step: "sharedImage", count: 120 },
    { step: "signedIn", count: 150 },
    { step: "published", count: 40 },
  ],
  retention: [
    { week: "2026-W47", size: 310, d1: 0.34, d7: 0.19, d30: null },
    { week: "2026-W46", size: 280, d1: 0.31, d7: 0.17, d30: 0.09 },
  ],
  pictureSearches: {
    top: [
      { q: "game consoles of the nineties", section: "games", count: 30 },
      { q: "dogs", section: "animals", count: 12 },
    ],
    empty: [{ q: "obscure band name", count: 4 }],
  },
  listSearches: { top: [{ q: "anime", count: 18 }] },
  lists: [{ id: "L1", title: "Every game console", opens: 90, copies: 12, finished: 7, shared: 3 }],
  topics: [{ id: "t1", name: "Pizza", section: "food", opens: 40, follows: 6 }],
  audience: {
    guests: 1500,
    google: 840,
    languages: [
      { code: "en", count: 1200 },
      { code: "ru", count: 400 },
    ],
    regions: [
      { code: "US", count: 700 },
      { code: "UA", count: 300 },
    ],
    versions: [{ platform: "android", version: "1.4.0 (140)", count: 1800 }],
  },
  referrers: [
    { domain: "reddit.com", count: 50 },
    { domain: "direct", count: 400 },
  ],
  crashes: {
    freeUsers: 0.996,
    freeSessions: 0.999,
    top: [
      {
        platform: "android",
        type: "IllegalStateException",
        place: "com.tieryourlife.board.BoardViewModel.save",
        version: "1.4.0",
        count: 7,
        people: 5,
        firstAt: Date.UTC(2026, 10, 18),
        lastAt: Date.UTC(2026, 10, 20),
      },
    ],
  },
  server: { errors5xx: 3, appCheckRefused: 12, catalogueBusy: 1, searchLimit: 0 },
  costs: { serper: 820, vision: 140 },
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
    (url) => url.pathname.endsWith("/lists/admin/statistics"),
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
  await expect(page.getByText("2,340")).toBeVisible();
}

test("Statistics fits the window: its tables scroll inside, the page never sideways", async ({
  page,
}, testInfo) => {
  await openStatistics(page);
  await expect(page.getByText("soulslikes")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("statistics.png"), fullPage: true });
});
