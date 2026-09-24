import { describe, expect, it } from "vitest";
import { isInAppBrowser } from "./inAppBrowser";

const IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A.231005.007";

describe("isInAppBrowser", () => {
  it.each([
    ["Instagram on iOS", `${IOS} Mobile/15E148 Instagram 334.0.0.0.42`],
    [
      "Facebook on Android",
      `${ANDROID}; wv) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0]`,
    ],
    [
      "Telegram on Android, its own browser",
      `${ANDROID}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 Telegram-Android/10.12`,
    ],
    [
      "a bare Android WebView",
      `${ANDROID}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36`,
    ],
    ["a bare WKWebView on iOS", `${IOS} Mobile/15E148`],
    ["TikTok on iOS", `${IOS} Mobile/15E148 musical_ly_34.0.0`],
  ])("knows %s", (_, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(true);
  });

  it.each([
    ["Safari on iOS", `${IOS} Version/17.5 Mobile/15E148 Safari/604.1`],
    ["Chrome on iOS", `${IOS} CriOS/125.0 Mobile/15E148 Safari/604.1`],
    ["Firefox on iOS", `${IOS} FxiOS/126.0 Mobile/15E148 Safari/605.1.15`],
    [
      "Chrome on Android",
      `${ANDROID}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36`,
    ],
    [
      "Chrome on a desk",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    ],
    [
      "Safari on a Mac",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ],
    [
      "Firefox on a desk",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    ],
    ["the test runner", "Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/24.0.0"],
  ])("lets %s through", (_, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(false);
  });
});
