import { expect, test } from "@playwright/test";
import { mockBackend } from "./fixtures";

// Instagram's browser on an iPhone: a WKWebView with the app's name appended.
test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.0.42",
});

// Google signs nobody in from a browser embedded in another app. The site says
// so where it offers Google, before the press, and the press never leaves for
// Google's error page.
test("in an app's browser the site says to open the page in a real one", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/settings");
  await expect(page.getByRole("note")).toContainText("Open this page in Chrome or Safari");

  await page.goto("/l/abc");
  await page.getByRole("button", { name: "Ex Machina", exact: true }).click();
  await page.getByRole("button", { name: "Place Ex Machina in S" }).click();
  await page.getByRole("button", { name: "Place The Witch in A" }).click();
  await page.getByRole("button", { name: "Place Climax in A" }).click();
  await page.getByRole("button", { name: "Finish" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("note")).toContainText("Open this page in Chrome or Safari");
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  // Still here, still the dialog: no redirect to Google.
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/l\/abc/);
});
