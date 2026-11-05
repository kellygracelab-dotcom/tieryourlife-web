import { afterEach, describe, expect, it, vi } from "vitest";
import { saveExport } from "./saveExport";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("saveExport", () => {
  it("names the file by the same day its first lines name, the person's own", () => {
    // 20:30 on 4 November in Los Angeles is already the 5th in UTC.
    vi.stubEnv("TZ", "America/Los_Angeles");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T04:30:00Z"));
    const save = vi.fn();
    saveExport([], save);
    const [name, text] = save.mock.calls[0] as [string, string];
    expect(text).toContain("November 4, 2026");
    expect(name).toBe("TierYourLife 2026-11-04.txt");
  });
});
