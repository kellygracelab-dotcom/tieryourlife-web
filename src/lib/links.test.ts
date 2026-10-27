import { describe, expect, it } from "vitest";
import { APP_STATUS, appIsLive, onApple, playUrl } from "./links";

describe("the way to the Android app", () => {
  // Google Play shows the app to its testers only until launch; a public link is a dead end.
  it("stays shut until the launch", () => {
    expect(APP_STATUS).toBe("testing");
    expect(appIsLive()).toBe(false);
    expect(appIsLive("live")).toBe(true);
  });

  it("tells Play Console which place a visitor came from", () => {
    expect(playUrl("footer")).toBe(
      "https://play.google.com/store/apps/details?id=com.artiuillab.tieryourlife" +
        "&referrer=utm_source%3Dweb%26utm_medium%3Dfooter",
    );
  });

  it("knows an iPhone and an iPad, which asks for the desktop site as a Mac", () => {
    const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });
    expect(onApple(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"))).toBe(true);
    expect(onApple(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5))).toBe(true);
    expect(onApple(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0))).toBe(false);
    expect(onApple(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5))).toBe(false);
  });
});
