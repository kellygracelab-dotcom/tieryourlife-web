import { expect, test } from "@playwright/test";
import { mockBackend } from "./fixtures";

// Firebase says who is here some 400 ms after the first paint. The cards a
// guest can use at once — the theme, the language — used to jump 200 px when
// the guest card arrived above them; now a card of the same shape holds the
// place. Measured with the answer held back, so the two states are both seen.
// Desktop Chromium has the account before the first paint, so it never shows
// the placeholder; the phones and WebKit take a moment, which is where it counts.
test.skip(
  ({ browserName, hasTouch }) => browserName === "chromium" && !hasTouch,
  "the account is known before the first paint here",
);

test("the settings page does not jump when the account arrives", async ({ page }) => {
  await mockBackend(page);
  // Firebase's answer waits until the first measurement is taken.
  let release = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/settings");
  const languages = page.getByRole("heading", { name: "Language" });
  await expect(languages).toBeVisible();
  await expect(page.locator(".settings__card[aria-busy]")).toBeVisible();
  const before = await languages.evaluate((el) => el.getBoundingClientRect().top);

  release();
  await expect(page.getByText("Sign in to change your settings.")).toBeVisible();
  await expect(page.locator(".settings__card[aria-busy]")).toHaveCount(0);
  const after = await languages.evaluate((el) => el.getBoundingClientRect().top);
  // The shape is the guest card's, not its exact height in every language and width: a
  // line or so may differ. It was 200 px.
  expect(Math.abs(after - before)).toBeLessThanOrEqual(32);
});
