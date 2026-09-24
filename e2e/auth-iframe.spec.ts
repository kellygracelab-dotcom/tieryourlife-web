import { expect, test } from "@playwright/test";
import { mockBackend } from "./fixtures";

// With getAuth()'s default resolver, Firebase fetched apis.google.com/js/api.js
// on every page a phone opened, to look for a redirect sign-in that had not
// happened. The resolver now travels with the sign-in calls, and a page that
// only ranks a list asks Google for nothing.
test("opening a list asks nothing of apis.google.com", async ({ page }) => {
  const google: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("apis.google.com")) google.push(request.url());
  });
  await mockBackend(page);
  await page.goto("/l/abc");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
  await page.getByRole("button", { name: "Ex Machina", exact: true }).click();
  await page.waitForLoadState("networkidle");
  expect(google).toEqual([]);
});
