import { describe, expect, it } from "vitest";
import { searchAgainAt } from "../../lib/searchLimit";
import { LinkRefused } from "../../lib/linkPictures";
import {
  busyText,
  linkFailureText,
  linkLimitText,
  missText,
  refusedText,
  waitingText,
} from "./linkText";

describe("what a refused picture from a link says", () => {
  it("says when more pictures from links come, or tomorrow when the backend did not say", () => {
    const now = new Date(2026, 10, 13, 12, 0).getTime();
    const at = new Date(2026, 10, 13, 14, 0).getTime();
    expect(linkLimitText(at, now)).toBe(
      `That’s all the pictures from links for today. More at ${searchAgainAt(at, now)}. You can still upload one from your device.`,
    );
    expect(linkLimitText(null)).toBe(
      "That’s all the pictures from links for today. More tomorrow. You can still upload one from your device.",
    );
  });

  it("has words for each reason", () => {
    expect(linkFailureText("notAPicture")).toMatch(/page, not a picture/);
    expect(linkFailureText("unreachable")).toMatch(/doesn’t open/);
    expect(linkFailureText("tooBig")).toMatch(/too big/);
    expect(linkFailureText("refused")).toMatch(/can’t be used here/);
    expect(linkFailureText("limit")).toMatch(/More tomorrow/);
    expect(linkFailureText("badLink")).toMatch(/page address/);
    expect(linkFailureText("signIn")).toBe("Sign in to add the picture");
    expect(linkFailureText("failed")).toMatch(/didn’t come through/);
  });

  it("says in a few words why a pasted card came without a picture", () => {
    expect(missText("notFound")).toBe("nothing by that name in the catalogue");
    expect(missText("signIn")).toBe("sign in to add pictures from links");
    expect(missText("limit")).toBe("no more pictures from links today");
    expect(missText("busy")).toBe("the picture’s site stayed busy");
  });

  it("says a busy picture site is a wait, with its time or in a moment", () => {
    const now = new Date(2026, 10, 13, 12, 0).getTime();
    const at = new Date(2026, 10, 13, 12, 5).getTime();
    const time = searchAgainAt(at, now);
    expect(busyText(at, now)).toBe(`The picture’s site is busy. Try again at ${time}.`);
    expect(busyText(null)).toBe("The picture’s site is busy. Try again in a moment.");
    expect(waitingText(at, now)).toBe(`Waiting for the source until ${time}…`);
    expect(linkFailureText("busy")).toBe("The picture’s site is busy. Try again in a moment.");
  });

  it("gives a refusal the day's end only for the limit, never for a busy site", () => {
    const quota = { left: 0, limit: 50, resetsAt: new Date(2026, 10, 14, 0, 0).getTime() };
    expect(refusedText(new LinkRefused("limit", null, quota))).toBe(linkLimitText(quota.resetsAt));
    expect(refusedText(new LinkRefused("busy", null, { ...quota, left: 9 }))).toBe(busyText(null));
    const at = Date.now() + 60_000;
    expect(refusedText(new LinkRefused("busy", at, null))).toBe(busyText(at));
    expect(refusedText(new LinkRefused("tooBig"))).toBe(linkFailureText("tooBig"));
  });
});
