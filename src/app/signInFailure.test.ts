import { describe, expect, it } from "vitest";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { POPUP_BLOCKED } from "../lib/signIn";
import { strings } from "../strings";
import { signInFailedText } from "./signInFailure";

describe("signInFailedText", () => {
  it("names a blocked Google window and the way out, not just Try again", () => {
    expect(signInFailedText(POPUP_BLOCKED)).toBe(strings.nav.signInBlocked);
    expect(strings.nav.signInBlocked).toContain("blocked the Google sign-in window");
    expect(strings.nav.signInBlocked).toContain("Allow pop-ups");
  });

  it("sends an app's own browser to a real one", () => {
    expect(signInFailedText(IN_APP_BROWSER)).toBe(strings.keep.inApp);
  });

  it("says the plain failure for anything else", () => {
    expect(signInFailedText("auth/network-request-failed")).toBe(strings.nav.signInFailed);
    expect(signInFailedText("unknown")).toBe(strings.nav.signInFailed);
  });
});
