import { describe, expect, it } from "vitest";
import {
  APP_STATUS,
  appIsLive,
  onApple,
  playUrl,
  siteHost,
  siteOrigin,
  SITE_ORIGIN,
} from "./links";

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

describe("the address a shared link points to", () => {
  const at = (origin: string) => ({ origin, hostname: new URL(origin).hostname });

  // tieryourlife.com is the one address (Danylo, 20.11.2026).
  it("is the public one on it, on www and on any of Firebase's hosts", () => {
    expect(SITE_ORIGIN).toBe("https://tieryourlife.com");
    expect(siteOrigin(at("https://tieryourlife.com"))).toBe(SITE_ORIGIN);
    expect(siteOrigin(at("https://www.tieryourlife.com"))).toBe(SITE_ORIGIN);
    expect(siteOrigin(at("https://tieryourlife.firebaseapp.com"))).toBe(SITE_ORIGIN);
    expect(siteOrigin(at("https://tieryourlife.web.app"))).toBe(SITE_ORIGIN);
    expect(siteOrigin(at("https://tieryourlife--pr-12-abc.web.app"))).toBe(SITE_ORIGIN);
    expect(siteHost(at("https://tieryourlife.firebaseapp.com"))).toBe("tieryourlife.com");
  });

  it("is the page's own on a copy of the site elsewhere", () => {
    expect(siteOrigin(at("http://127.0.0.1:5173"))).toBe("http://127.0.0.1:5173");
    expect(siteHost(at("http://localhost:5173"))).toBe("localhost:5173");
  });
});
