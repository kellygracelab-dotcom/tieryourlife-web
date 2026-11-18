import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBackend } from "./fixtures";
import { PIXEL } from "./signedIn";

/** A press the way the project's device makes it: a finger taps, a mouse clicks. */
const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

/** A list of football clubs: one a film's poster, one nobody knows, two clubs. */
const CLUBS: Record<string, object[]> = {
  Liverpool: [
    {
      id: "wikidata:Q1",
      title: "Liverpool F.C.",
      subtitle: "football club",
      imageUrl: "https://img.test/liverpool.png",
      thumbUrl: null,
      source: "wikidata",
      kind: "thing",
    },
    {
      id: "wikidata:Q2",
      title: "Liverpool",
      subtitle: "football club in England",
      imageUrl: "https://img.test/liverpool.png",
      thumbUrl: null,
      source: "wikidata",
      kind: "thing",
    },
  ],
  Arsenal: [
    {
      id: "wikidata:Q9617",
      title: "Arsenal F.C.",
      subtitle: "football club",
      imageUrl: "https://img.test/arsenal-fc.png",
      thumbUrl: null,
      source: "wikidata",
      kind: "thing",
    },
    {
      id: "tmdb:1",
      title: "Arsenal",
      subtitle: "1929",
      imageUrl: "https://img.test/arsenal.png",
      thumbUrl: null,
      source: "tmdb",
      kind: "movie",
    },
  ],
  "Real Madrid": [
    {
      id: "wikidata:Q8682",
      title: "Real Madrid",
      subtitle: "Spanish football club",
      imageUrl: "https://img.test/real.png",
      thumbUrl: null,
      source: "wikidata",
      kind: "thing",
    },
  ],
};

async function pasteBox(page: Page, touch: boolean) {
  await mockBackend(page);
  await page.route("**/lists/pictures?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    return route.fulfill({ json: { items: CLUBS[q] ?? [], hasMore: false, notices: [] } });
  });
  await page.route("https://img.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  await page.goto("/new?title=Football%20clubs&category=sport");
  const title = page.getByRole("textbox", { name: "Title" });
  // The first page of a cold server is slow to come.
  await expect(title).toHaveValue("Football clubs", { timeout: 20_000 });
  await title.press("Enter");
  if (touch) await press(page.getByRole("button", { name: "Add", exact: true }), touch);
  await press(page.getByRole("button", { name: "Paste a list" }), touch);
}

/** The box stands inside the pool's panel on a wide window, and inside the window on a phone. */
async function expectInside(page: Page, box: Locator) {
  const at = (await box.boundingBox())!;
  const pool = (await page.locator(".pool").first().boundingBox())!;
  const width = page.viewportSize()!.width;
  const [left, right] = width >= 840 ? [pool.x, pool.x + pool.width] : [0, width];
  expect(at.x).toBeGreaterThanOrEqual(left - 0.5);
  expect(at.x + at.width).toBeLessThanOrEqual(right + 0.5);
}

test("Paste a list: the names and where to look, then the pictures checked", async ({
  page,
  hasTouch,
}) => {
  await pasteBox(page, hasTouch);
  const names = page.getByRole("textbox", { name: "Paste a list" });
  await expect(page.getByText("One card per line. Pictures are found by name.")).toBeVisible();
  await expect(names).toHaveAttribute("placeholder", /\n.*\n/);
  // A list of sport has no catalogue of its own: All is where its pictures are looked for.
  const where = page.getByRole("group", { name: "Look for pictures in" });
  await expect(where.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await expectInside(page, page.locator(".cards__paste--open"));

  await names.fill("Liverpool\nArsenal\nPSG\nReal Madrid");
  await press(page.getByRole("button", { name: "Find pictures for 4 names" }), hasTouch);
  const check = page.getByRole("region", { name: "Check the pictures" });
  await expect(check).toBeVisible();
  await expect(check.getByRole("status")).toHaveText(
    "4 names · 2 look right · 1 needs a look · 1 has no picture",
  );
  const rows = check.getByRole("listitem");
  await expect(rows.nth(0)).toContainText("ArsenalA film poster — is that right?");
  await expect(rows.nth(1)).toContainText("PSGNothing found by that name");
  await expect(rows.nth(2)).toContainText("Liverpool");
  await expectInside(page, check);

  // Back keeps the names; Find again asks nothing it already knows.
  await press(check.getByRole("button", { name: "Back" }), hasTouch);
  await expect(names).toHaveValue("Liverpool\nArsenal\nPSG\nReal Madrid");
  await press(page.getByRole("button", { name: "Find pictures for 4 names" }), hasTouch);
  await expect(check).toBeVisible();

  // The film's poster goes; another picture is found for the club nobody knew.
  await press(check.getByRole("button", { name: "No picture for Arsenal" }), hasTouch);
  await press(check.getByRole("button", { name: "Find one for PSG" }), hasTouch);
  await check.getByRole("textbox", { name: "Search a picture for PSG" }).fill("Real Madrid");
  await press(check.getByRole("button", { name: /^Real Madrid/ }), hasTouch);
  await expect(check.getByRole("status")).toHaveText("4 names · 3 look right · 1 has no picture");

  await press(check.getByRole("button", { name: "Add 4 cards" }), hasTouch);
  await expect(check).toBeHidden();
  await expect(page.getByText(/0 of 4 placed/)).toBeVisible();
  for (const name of ["Liverpool", "Arsenal", "PSG", "Real Madrid"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeAttached();
  }
});

test("Paste a list: the names go to the backend together, judged there", async ({
  page,
  hasTouch,
}) => {
  await pasteBox(page, hasTouch);
  const batches: string[][] = [];
  let singles = 0;
  page.on("request", (request) => {
    if (request.url().includes("/lists/pictures?")) singles++;
  });
  await page.route("**/lists/pictures/batch", (route) => {
    const body = route.request().postDataJSON() as { names: string[]; section?: string };
    batches.push(body.names);
    const club = (q: string) => ({ ...(CLUBS[q]?.[0] ?? {}), confidence: "high" });
    return route.fulfill({
      json: {
        results: body.names.map((q) =>
          q === "PSG"
            ? { q, status: "none" }
            : q === "Arsenal"
              ? {
                  q,
                  status: "found",
                  item: { ...club(q), confidence: "medium", doubts: ["namesakes"] },
                }
              : { q, status: "found", item: club(q) },
        ),
      },
    });
  });
  await page
    .getByRole("textbox", { name: "Paste a list" })
    .fill("Liverpool\nArsenal\nPSG\nReal Madrid");
  await press(page.getByRole("button", { name: "Find pictures for 4 names" }), hasTouch);
  const check = page.getByRole("region", { name: "Check the pictures" });
  await expect(check.getByRole("status")).toHaveText(
    "4 names · 2 look right · 1 needs a look · 1 has no picture",
  );
  expect(batches).toEqual([["Liverpool", "Arsenal", "PSG", "Real Madrid"]]);
  expect(singles).toBe(0);
});
