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
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await page.getByRole("button", { name: "Ex Machina", exact: true }).click();
  await page.getByRole("button", { name: "Place Ex Machina in S · Masterpiece" }).click();
  await page.getByRole("button", { name: "Place The Witch in A · Great" }).click();
  await page.getByRole("button", { name: "Place Climax in A · Great" }).click();
  // Every card placed: the offer to show it in Rankings asks a guest to sign in first.
  const offer = page.getByRole("complementary", { name: "Show others how you ranked it?" });
  await expect(offer.getByRole("note")).toContainText("Open this page in Chrome or Safari");
  await offer.getByRole("button", { name: "Sign in to share" }).click();
  // Still here, still the offer: no redirect to Google, and no failure said over the note.
  await expect(offer).toBeVisible();
  await expect(offer.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/l\/abc/);
});
