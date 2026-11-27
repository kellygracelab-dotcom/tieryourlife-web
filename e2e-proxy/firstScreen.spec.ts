import { expect, test, type Page } from "@playwright/test";
import { device, put, type Plain } from "./emulated";

/*
 * Community's first screen (/api/home, the site's own function) against the
 * real proxy: the same lists in the same order, the same row of new ones, the
 * same tiles and the same cards a guest's live answers carry. The function
 * reads them itself (functions/src/homeFirst.ts, a copy of the proxy's way at
 * 9e86c84): this is where a change on either side shows.
 */

const STORAGE = "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/";
const stored = (path: string) => `${STORAGE}${encodeURIComponent(path)}?alt=media`;

type Answers = Partial<Record<"home" | "popular" | "fresh" | "sections", unknown>>;

/** The front page as a new guest opens it, and what each of the four answered. */
async function frontPage(page: Page): Promise<Answers> {
  const answers: Answers = {};
  page.on("response", async (response) => {
    const url = new URL(response.url());
    const query = [...url.searchParams.keys()].join(",");
    const key =
      url.pathname === "/api/home"
        ? "home"
        : url.pathname === "/lists" &&
            query === "sort" &&
            url.searchParams.get("sort") === "popular"
          ? "popular"
          : url.pathname === "/lists" && query === "fresh"
            ? "fresh"
            : url.pathname === "/lists/sections"
              ? "sections"
              : null;
    if (key !== null && response.ok()) answers[key] = await response.json();
  });
  await page.goto("/");
  await expect
    .poll(() => Object.keys(answers).sort().join(","), { timeout: 60_000 })
    .toBe("fresh,home,popular,sections");
  return answers;
}

const ids = (lists: { id: string }[]) => lists.map((one) => one.id);

test("draws the first screen as the proxy answers a guest: Popular, New, the tiles and every card", async ({
  browser,
}) => {
  // Once, so the proxy has made its built-in sections before anything is compared.
  await frontPage(await device(browser));

  const run = Date.now().toString(36);
  const now = Date.now();
  const card = (id: string, n: number) => ({
    imageUrl: stored(`published/${id}/p${n}`),
    tierIndex: n % 4,
  });
  const list = (id: string, over: Record<string, Plain> = {}) =>
    put("publishedLists", id, {
      title: `First screen ${id}`,
      authorUid: `author-${run}-${id.length % 3}`,
      authorName: "Ann",
      authorPhotoUrl: null,
      category: ["film_tv", "games", "food"][id.length % 3]!,
      itemCount: 10,
      coverImageUrl: stored(`published/${id}/cover`),
      previewImages: [],
      tierColors: ["#e53935", "#fb8c00"],
      tiers: [{ label: "S" }, { label: "A" }, { label: "B" }, { label: "C" }],
      items: Array.from({ length: 10 }, (_, n) => card(id, n)),
      takeCount: 0,
      rankingCount: 0,
      updatedAt: new Date(now - 1000),
      publishedAt: new Date(now - 1000),
      ...over,
    });
  const seeded = [
    // Popular: most taken, then the newest; never one held or waiting.
    ...Array.from({ length: 24 }, (_, n) =>
      list(`${run}p${n}`, {
        takeCount: 1000 + (n % 5),
        updatedAt: new Date(now - n * 60_000),
      }),
    ),
    list(`${run}held`, { takeCount: 5000, underReview: true }),
    list(`${run}waits`, { takeCount: 5000, awaitingApproval: true }),
    // New: the house's, a nameless one, too few cards, a banned author's are left out.
    list(`${run}house`, { authorUid: "tyl-editorial" }),
    list(`${run}nameless`, { anonymous: true }),
    list(`${run}few`, { items: [card("few", 0)], itemCount: 1 }),
    list(`${run}banned`, { authorUid: `banned-${run}` }),
    // A collage card, with a translated title and a copy's credit.
    list(`${run}collage`, {
      title: "Cats",
      coverImageUrl: "null",
      previewImages: [1, 2, 3, 4].map((n) => stored(`published/${run}collage/p${n}`)),
      translations: { ru: { Cats: "Кошки" } },
      basedOn: { id: "x", title: "Dogs", authorUid: "u9", authorName: "Bo" },
      takeCount: 2000,
    }),
  ];
  await Promise.all(seeded);
  await put("bans", `banned-${run}`, { until: null });
  // The proxy's counts are read again on the next request, as after any publish.
  await put("config", "sectionCounts", { changes: now, changedAtMs: now });

  const answers = await frontPage(await device(browser));
  const home = answers.home as {
    popular: { lists: Record<string, unknown>[]; nextCursor: string | null };
    fresh: Record<string, unknown>[];
    sections: Record<string, unknown>[];
  };
  const popular = answers.popular as {
    lists: Record<string, unknown>[];
    nextCursor: string | null;
  };
  const fresh = answers.fresh as { lists: Record<string, unknown>[] };
  const sections = answers.sections as { sections: Record<string, unknown>[] };

  // The same lists in the same order, the same cursor, each card the same.
  expect(ids(home.popular.lists as { id: string }[])).toEqual(
    ids(popular.lists as { id: string }[]),
  );
  expect(home.popular.nextCursor).toBe(popular.nextCursor);
  expect(home.popular.lists).toEqual(popular.lists);
  expect(ids(home.popular.lists as { id: string }[])).not.toContain(`${run}held`);
  expect(ids(home.popular.lists as { id: string }[])).not.toContain(`${run}waits`);

  expect(home.fresh).toEqual(fresh.lists);
  const freshIds = ids(home.fresh as { id: string }[]);
  for (const out of ["house", "nameless", "few", "banned", "held", "waits"]) {
    expect(freshIds).not.toContain(`${run}${out}`);
  }

  // Every tile the proxy gives a guest, with what the tile draws and orders by.
  const tiles = sections.sections.filter((one) => one.status === "approved" && !one.hidden);
  expect(home.sections.map((one) => one.id).sort()).toEqual(tiles.map((one) => one.id).sort());
  for (const tile of home.sections) {
    const live = tiles.find((one) => one.id === tile.id);
    for (const [key, value] of Object.entries(tile)) {
      expect(live?.[key], `${String(tile.id)}.${key}`).toEqual(value);
    }
  }
});
