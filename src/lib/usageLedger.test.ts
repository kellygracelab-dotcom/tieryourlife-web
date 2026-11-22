import { describe, expect, it } from "vitest";
import {
  after,
  batchOf,
  counted,
  crashedIn,
  crashOf,
  dayOf,
  dropped,
  freshLedger,
  isoWeekOf,
  ledgerOf,
  pickedAt,
  pickedFrom,
  referrerOf,
  sessionBegun,
  stepped,
  USAGE_STEPS,
} from "./usageLedger";

const DAY = 20_412; // 2025-11-19 … any day will do; weeks are checked on their own below.
const dayOfDate = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

describe("the usage ledger", () => {
  it("names ISO weeks as the server reads them, across a year's edges", () => {
    expect(isoWeekOf(dayOfDate("2026-11-20"))).toBe("2026-W47");
    expect(isoWeekOf(dayOfDate("2026-01-01"))).toBe("2026-W01");
    expect(isoWeekOf(dayOfDate("2027-01-01"))).toBe("2026-W53");
    expect(isoWeekOf(dayOfDate("2024-12-30"))).toBe("2025-W01");
  });

  it("counts UTC days as the server does, whatever the browser's time zone", () => {
    expect(dayOf(Date.parse("2026-11-20T00:00:00Z"))).toBe(dayOfDate("2026-11-20"));
    expect(dayOf(Date.parse("2026-11-20T23:59:59.999Z"))).toBe(dayOfDate("2026-11-20"));
    // 22:10 UTC is the 21st in Kyiv: still the 20th for the server, and so here.
    expect(dayOf(Date.parse("2026-11-21T00:10:00+02:00"))).toBe(dayOfDate("2026-11-20"));
    expect(dayOf(Date.parse("2026-11-21T00:00:00Z"))).toBe(dayOfDate("2026-11-21"));
  });

  it("sends active once a UTC day, though the local day turned over in between", () => {
    const at = (iso: string) => dayOf(Date.parse(iso));
    // Kyiv, 00:10 on the 21st local = 22:10 UTC on the 20th, after a batch at 20:00 UTC.
    const first = freshLedger(at("2026-11-20T20:00:00Z"), true, true);
    const sent = after(
      counted(first, "share.link"),
      batchOf(counted(first, "share.link"), at("2026-11-20T20:00:00Z"), "v", null)!,
      at("2026-11-20T20:00:00Z"),
    );
    expect(
      batchOf(counted(sent, "share.link"), at("2026-11-21T00:10:00+02:00"), "v", null)!.active,
    ).toBeUndefined();
    // The next UTC day it goes again, a day after.
    expect(batchOf(sent, at("2026-11-21T09:00:00+02:00"), "v", null)!.active).toMatchObject({
      gap: 1,
    });
  });

  it("starts a newcomer with its first launch waiting, and a returning browser with its steps behind it", () => {
    const fresh = freshLedger(DAY, false, true);
    expect(fresh.firstDay).toBe(DAY);
    expect(fresh.stepsWaiting).toEqual(["first_launch"]);
    const off = freshLedger(DAY, false, false);
    expect(off.stepsWaiting).toEqual([]);
    expect(off.stepsDone).toEqual(["first_launch"]);
    const back = freshLedger(DAY, true, true);
    expect(back.stepsDone).toEqual([...USAGE_STEPS]);
    expect(back.stepsWaiting).toEqual([]);
    // Long ago: past the 30 days retention looks at, in no newcomers' week.
    expect(back.firstDay).toBe(DAY - 365);
  });

  it("sends each step once, and a step passed while off never", () => {
    let ledger = freshLedger(DAY, false, true);
    ledger = stepped(ledger, "first_board", true);
    ledger = stepped(ledger, "first_board", true);
    expect(ledger.stepsWaiting).toEqual(["first_launch", "first_board"]);
    ledger = stepped(ledger, "shared", false);
    expect(ledger.stepsDone).toContain("shared");
    expect(stepped(ledger, "shared", true)).toBe(ledger);
  });

  it("makes the day's first batch say how long it has been, and later ones only what is new", () => {
    let ledger = sessionBegun(freshLedger(DAY, false, true), { domain: "reddit.com", utm: "" });
    ledger = counted(counted(ledger, "share.image"), "share.image");
    const first = batchOf(ledger, DAY, "2026.11.20-abc1234", "ru-UA")!;
    expect(first).toEqual({
      version: "2026.11.20-abc1234",
      locale: "ru-UA",
      active: { gap: 31, sinceFirst: 0, firstWeek: isoWeekOf(DAY) },
      steps: ["first_launch"],
      features: { session: 1, "share.image": 2 },
      sessions: 1,
      crashedSessions: 0,
      crashes: [],
      referrer: { domain: "reddit.com", utm: "" },
    });
    const sent = after(ledger, first, DAY);
    expect(sent.lastActiveDay).toBe(DAY);
    expect(sent.stepsDone).toContain("first_launch");
    expect(sent.counts).toEqual({});
    expect(sent.referrer).toBeNull();
    expect(batchOf(sent, DAY, "v", null)).toBeNull();

    const later = batchOf(counted(sent, "share.link"), DAY, "v", null)!;
    expect(later.active).toBeUndefined();
    expect(later.locale).toBeUndefined();
    expect(later.features).toEqual({ "share.link": 1 });

    const threeDaysOn = batchOf(sent, DAY + 3, "v", null)!;
    expect(threeDaysOn.active).toEqual({ gap: 3, sinceFirst: 3, firstWeek: isoWeekOf(DAY) });
    expect(batchOf(sent, DAY + 45, "v", null)!.active!.gap).toBe(31);
  });

  it("keeps what came while a batch was out, and caps what one batch carries", () => {
    let ledger = freshLedger(DAY, true, true);
    for (let i = 0; i < 250; i++) ledger = counted(ledger, "board.tier");
    const batch = batchOf(ledger, DAY, "v", null)!;
    expect(batch.features["board.tier"]).toBe(200);
    const left = after(counted(ledger, "share.link"), batch, DAY);
    expect(left.counts).toEqual({ "board.tier": 50, "share.link": 1 });
  });

  it("counts a session as crashed once, keeps the newest five errors, and never more crashed than sessions", () => {
    let ledger = sessionBegun(freshLedger(DAY, true, true), null);
    for (let i = 0; i < 7; i++)
      ledger = crashedIn(ledger, { type: "E", place: `a.js:${i}` }, i === 0);
    expect(ledger.crashedSessions).toBe(1);
    expect(ledger.crashes.map((crash) => crash.place)).toEqual([
      "a.js:2",
      "a.js:3",
      "a.js:4",
      "a.js:5",
      "a.js:6",
    ]);
    const batch = batchOf({ ...ledger, crashedSessions: 4 }, DAY, "v", null)!;
    expect(batch.crashedSessions).toBe(1);
    expect(after(ledger, batch, DAY).crashes).toEqual([]);
  });

  it("drops what waited when turned off, spending its steps", () => {
    const ledger = counted(freshLedger(DAY, false, true), "share.link");
    const off = dropped(ledger);
    expect(off.counts).toEqual({});
    expect(off.stepsWaiting).toEqual([]);
    expect(off.stepsDone).toContain("first_launch");
  });

  it("reads back a kept ledger and nothing it cannot use", () => {
    const ledger = sessionBegun(freshLedger(DAY, false, true), { domain: "a.com", utm: "x" });
    expect(ledgerOf(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
    expect(ledgerOf(null)).toBeNull();
    expect(ledgerOf([])).toBeNull();
    expect(ledgerOf({ firstDay: "x" })).toBeNull();
    expect(
      ledgerOf({
        firstDay: 3,
        counts: { a: 2, b: -1, c: "x" },
        crashes: [{ type: "E", place: "p" }, { type: 1 }],
        stepsDone: ["shared", 4],
        referrer: { domain: 1 },
        sessions: -3,
      }),
    ).toMatchObject({
      firstDay: 3,
      lastActiveDay: null,
      counts: { a: 2 },
      crashes: [{ type: "E", place: "p" }],
      stepsDone: ["shared"],
      referrer: null,
      sessions: 0,
    });
  });

  it("names a picked picture's source and place as the server counts them", () => {
    expect(pickedFrom("TMDB")).toBe("picture.pick.tmdb");
    expect(pickedFrom("somewhere")).toBe("picture.pick.other");
    expect(pickedFrom(null)).toBe("picture.pick.other");
    expect([0, 1, 2, 3, 9, 10, 40].map(pickedAt)).toEqual([
      "picture.pos.1",
      "picture.pos.2-3",
      "picture.pos.2-3",
      "picture.pos.4-10",
      "picture.pos.4-10",
      "picture.pos.11+",
      "picture.pos.11+",
    ]);
  });
});

describe("crashOf", () => {
  const origin = "https://tieryourlife.com";
  const thrown = (name: string, stack: string) => {
    const error = new Error("what somebody typed");
    error.name = name;
    error.stack = stack;
    return error;
  };

  it("takes the error's name and the first line of the site's own code, never the message", () => {
    const crash = crashOf(
      thrown(
        "TypeError",
        "TypeError: what somebody typed\n    at x (chrome-extension://abc/inject.js:1:2)\n    at board (https://tieryourlife.com/assets/BoardPage-Ab12.js:3:4567)\n    at y (https://tieryourlife.com/assets/index.js:9:1)",
      ),
      origin,
    );
    expect(crash).toEqual({ type: "TypeError", place: "BoardPage-Ab12.js:3" });
  });

  it("reads Safari's and Firefox's stacks too", () => {
    expect(
      crashOf(thrown("RangeError", "board@https://tieryourlife.com/assets/a.js?v=1:12:5"), origin),
    ).toEqual({ type: "RangeError", place: "a.js:12" });
  });

  it("leaves out errors that are not the site's, and things that are not errors", () => {
    expect(crashOf(thrown("Error", "at x (https://other.example/x.js:1:1)"), origin)).toBeNull();
    expect(crashOf(thrown("Error", ""), origin)).toBeNull();
    expect(crashOf("a string", origin)).toBeNull();
    expect(crashOf(undefined, origin)).toBeNull();
  });
});

describe("referrerOf", () => {
  const here = "https://tieryourlife.com/l/abc";

  it("keeps the other site's domain alone, without www", () => {
    expect(referrerOf("https://www.reddit.com/r/tierlists/comments/1?x=y", here)).toEqual({
      domain: "reddit.com",
      utm: "",
    });
  });

  it("adds the campaign tag of the address, and keeps a tag with no site", () => {
    expect(referrerOf("https://t.co/x", `${here}?utm_source=Twitter`)).toEqual({
      domain: "t.co",
      utm: "twitter",
    });
    expect(referrerOf("", `${here}?utm_source=newsletter`)).toEqual({
      domain: "",
      utm: "newsletter",
    });
  });

  it("says nothing for the site itself, for nowhere, or for what the server would not read", () => {
    expect(referrerOf("https://tieryourlife.com/", here)).toBeNull();
    expect(referrerOf("", here)).toBeNull();
    expect(referrerOf("android-app://com.google/", here)).toBeNull();
    expect(referrerOf("not a url", here)).toBeNull();
    expect(referrerOf("https://a.com", "not a url")).toBeNull();
    expect(referrerOf("", `${here}?utm_source=${"x".repeat(60)}`)).toBeNull();
  });
});
