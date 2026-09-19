import { expect, test } from "@playwright/test";
import { list, mockBackend } from "./fixtures";

// The app is imported after the dictionary, as a piece of its own. When that
// piece does not arrive there used to be a blank page and not a word.
test("a part of the site that fails to arrive once is fetched again, and nobody notices", async ({
  page,
}) => {
  await mockBackend(page);
  let asked = 0;
  await page.route("**/src/App.tsx*", (route) => {
    asked += 1;
    return asked === 1 ? route.abort("connectionreset") : route.continue();
  });

  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  expect(asked).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The note that a reload was tried does not outlive the start that worked.
  expect(await page.evaluate(() => sessionStorage.getItem("tyl:boot-retry"))).toBeNull();
});

test("says so, with a way out, when the site cannot start at all", async ({ page }) => {
  await mockBackend(page);
  let down = true;
  let asked = 0;
  await page.route("**/src/App.tsx*", (route) => {
    asked += 1;
    return down ? route.abort("connectionreset") : route.continue();
  });

  await page.goto(`/l/${list.id}`);
  const trouble = page.getByRole("alert");
  await expect(trouble.getByRole("heading", { level: 1 })).toHaveText("The site could not start");
  await expect(trouble).toContainText("Reloading usually does it.");
  // One quiet reload and no more: it must not go round for ever.
  expect(asked).toBe(2);

  down = false;
  await trouble.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(list.title);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
