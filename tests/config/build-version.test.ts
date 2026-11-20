import { describe, expect, it } from "vitest";
import { buildVersion, buildVersionDefine } from "../../config/build-version";

describe("buildVersion", () => {
  it("is the commit's day and its short id, from the commit rather than the clock", () => {
    const read = (args: string[]) => (args[0] === "rev-parse" ? "327ea66" : "2026.11.20");
    expect(buildVersion(read)).toBe("2026.11.20-327ea66");
  });

  it("is dev without git, or with anything git would not say", () => {
    expect(buildVersion(() => null)).toBe("dev");
    expect(buildVersion((args) => (args[0] === "rev-parse" ? "nonsense" : "2026.11.20"))).toBe(
      "dev",
    );
  });

  it("fits what the server reads as a version", () => {
    const define = buildVersionDefine();
    expect(JSON.parse(define.__TYL_BUILD__!)).toMatch(/^[0-9A-Za-z._-]{1,24}$/);
  });
});
