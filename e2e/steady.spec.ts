import { expect, test, type Page } from "@playwright/test";
import { list, mockBackend } from "./fixtures";
import { PIXEL, signIn } from "./signedIn";

/*
 * Nothing on a page jumps while it arrives: the backend answers late, the way
 * the real one does from far away, and every shift the browser counts before
 * anybody touches the page is a failure. Danylo saw the front page teleport
 * when Explore and Following came in, the sections reorder and the pictures
 * flash in after the built-in art.
 */

const LATE_MS = 600;

const picture = (kind: string, id: string) =>
  `https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/${kind}%2F${id}%2Fp1?alt=media`;

const section = (id: string, rank: number, listCount: number) => ({
  id,
  rank,
  builtIn: true,
  status: "approved",
  listCount,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: id === "games",
  pictureUrl: picture("sections", id),
});

// Not the built-in order: the answer reorders the tiles if the page drew its own first.
const SECTIONS = [
  section("games", 1, 40),
  section("anime", 2, 30),
  section("film_tv", 3, 20),
  section("music", 4, 9),
  section("books", 5, 8),
  section("food", 6, 7),
  section("sport", 7, 6),
  section("people", 8, 5),
  section("other", 9, 1),
];

const TOPICS = [
  {
    id: "t1",
    name: "Star Wars",
    section: "anime",
    status: "approved",
    listCount: 2,
    followerCount: 3,
    following: false,
    mergedInto: null,
    pictureUrl: picture("topics", "t1"),
  },
];

const summary = (id: string) => ({
  id,
  title: `List ${id}`,
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 12,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

const late = () => new Promise((resolve) => setTimeout(resolve, LATE_MS));

/** The community's answers, each late; whatever else the page asks falls through to the fixtures. */
async function lateBackend(page: Page, lists: number) {
  // The dev server hands Roboto out afresh on every visit; the site's own copy
  // is kept for a year, so a page seen before never waits for it. Without it
  // here, what moves is the page, not the font swapping in.
  await page.route(/roboto-.*\.woff2?$/, (route) => route.abort());
  await page.route("**/img/**", async (route) => {
    await late();
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await page.route(
    (url) => /\/lists(\/|$)/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== "fetch" && request.resourceType() !== "xhr") {
        return route.fallback();
      }
      const url = new URL(request.url());
      const path = url.pathname.slice(url.pathname.search(/\/lists(\/|$)/));
      await late();
      if (path === "/lists/sections") return route.fulfill({ json: { sections: SECTIONS } });
      if (path === "/lists/topics") {
        const q = url.searchParams.get("q");
        const found = TOPICS.filter(
          (one) => q === null || one.name.toLowerCase().startsWith(q.toLowerCase()),
        );
        return route.fulfill({ json: { topics: found } });
      }
      if (path === "/lists/topics/mine") return route.fulfill({ json: { topics: [] } });
      if (path === "/lists/topics/t1") return route.fulfill({ json: TOPICS[0] });
      if (path === "/lists" && request.method() === "GET") {
        const following = url.searchParams.get("following");
        return route.fulfill({
          json: {
            lists: Array.from({ length: following ? 0 : lists }, (_, n) => summary(`L${n}`)),
            nextCursor: null,
            followingNobody: following ? false : undefined,
          },
        });
      }
      return route.fallback();
    },
  );
}

interface Shift {
  value: number;
  at: number;
  what: string[];
}

/** Every shift the browser counted from the first paint, without input to excuse it. */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const seen: Shift[] = [];
    (window as unknown as { shifts: Shift[] }).shifts = seen;
    const name = (node: Node | null | undefined) =>
      node instanceof Element
        ? `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]}`
        : "?";
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries() as unknown as {
        value: number;
        startTime: number;
        hadRecentInput: boolean;
        sources: { node?: Node; previousRect: DOMRect; currentRect: DOMRect }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        seen.push({
          value: entry.value,
          at: Math.round(entry.startTime),
          what: entry.sources.map(
            (s) =>
              `${name(s.node)} y${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}`,
          ),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function shiftsOn(page: Page, path: string): Promise<Shift[]> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(LATE_MS * 2);
  return page.evaluate(() => (window as unknown as { shifts: Shift[] }).shifts);
}

const PAGES = [
  "/",
  "/following",
  "/s",
  "/s/anime",
  "/s/anime/t/t1",
  "/search?q=star",
  "/b",
  "/me",
  `/l/${list.id}`,
  "/settings",
  "/about",
];

test.describe("arriving without a jump", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "only Chromium counts layout shifts");

  for (const who of ["guest", "signed in"] as const) {
    for (const path of PAGES) {
      test(`${path}, ${who}`, async ({ page }) => {
        if (who === "guest") await mockBackend(page);
        else await signIn(page);
        await lateBackend(page, path === "/" ? 4 : 0);
        await watchShifts(page);
        // Once to be here before, as nearly everybody opening a page has been,
        // then again: that second arrival is the one that must not move.
        for (const visit of ["first", "again"] as const) {
          const shifts = await shiftsOn(page, path);
          for (const one of shifts) {
            console.log(
              `SHIFT ${path} | ${who} ${visit} | ${one.value.toFixed(4)} @${one.at} | ${one.what.join(" ; ")}`,
            );
          }
          if (visit === "again") {
            expect(shifts.reduce((sum, one) => sum + one.value, 0)).toBeLessThan(0.001);
          }
        }
      });
    }
  }
});
